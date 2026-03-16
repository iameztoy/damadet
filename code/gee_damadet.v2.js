/**** 
 * PWTT v2 for Google Earth Engine JavaScript
 * Gaza example + optional terrain flattening + optional building footprints
 * 
 * Default behavior:
 *   - Runs PWTT raster over Gaza
 *   - Footprints are OFF by default so the script runs safely
 *   - Terrain flattening is OFF by default
 *
 * After it runs once, the first thing I suggest testing is:
 *   USE_FOOTPRINTS = true;
 *   FOOTPRINT_SOURCE = 'VIDA_COMBINED';
 ****/


// ============================================================
// 0) USER SETTINGS
// ============================================================

// AOI presets
var AOI_MODE = 'FULL_GAZA';   // FULL_GAZA | NORTH_GAZA_TEST

var FULL_GAZA = ee.Geometry.Rectangle([34.21, 31.21, 34.57, 31.60], null, false);
var NORTH_GAZA_TEST = ee.Geometry.Rectangle([34.38, 31.48, 34.50, 31.58], null, false);

var aoi = (AOI_MODE === 'FULL_GAZA') ? FULL_GAZA : NORTH_GAZA_TEST;

// PWTT dates and thresholds
var warStart = ee.Date('2023-10-10');
var inferenceStart = ee.Date('2024-07-01');
var preIntervalMonths = 12;
var postIntervalMonths = 1;

var builtThreshold = 0.10;
var rasterDamageThreshold = 3.0;     // for raster preview
var buildingDamageThreshold = 3.2;   // for footprint mean(T) classification
var minBuildingAreaM2 = 50;

// Footprints
var USE_FOOTPRINTS = false;
var RUN_FOOTPRINT_ZONAL_STATS = false;   // set true to compute mean T per building
var FOOTPRINT_SOURCE = 'VIDA_COMBINED';  // VIDA_COMBINED | MSBUILDINGS_AUTO | GHS_OBAT_AUTO | OBM | GOOGLE_OPEN_BUILDINGS | CUSTOM
var COUNTRY_ISO3 = 'PSE';
var CUSTOM_FOOTPRINT_ASSET = '';         // fill only if FOOTPRINT_SOURCE == 'CUSTOM'
var DISPLAY_MAX_FOOTPRINTS = 5000;       // preview limit on map
var EXPORT_BUILDING_TABLE = false;

// Terrain flattening
var USE_TERRAIN_FLATTENING = false;
var TERRAIN_FLATTENING_MODEL = 'DIRECT';  // DIRECT | VOLUME
var TERRAIN_FLATTENING_BUFFER_METERS = 30;
var DEM = ee.Image('COPERNICUS/DEM/GLO30').select('DEM');

// Optional exports
var EXPORT_RASTER = false;
var EXPORT_FOLDER = 'PWTT_Export';

// Map
Map.setOptions('SATELLITE');
Map.centerObject(aoi, (AOI_MODE === 'FULL_GAZA') ? 10 : 13);


// ============================================================
// 1) GENERAL HELPERS
// ============================================================
function deg2rad(img) {
  return img.multiply(Math.PI / 180.0);
}

function getS1Base(aoiGeom) {
  return ee.ImageCollection('COPERNICUS/S1_GRD_FLOAT')
    .filterBounds(aoiGeom)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
    .select(['VV', 'VH', 'angle']);
}

function toNaturalLog(img) {
  var out = img.select(['VV', 'VH']).log();
  return out.copyProperties(img, img.propertyNames());
}


// ============================================================
// 2) LEE FILTER
// ============================================================
function leeFilter(image) {
  var kernelSize = 2;
  var bandNames = ee.List(image.bandNames()).remove('angle');

  var enl = 5;
  var eta = ee.Image.constant(1.0 / Math.sqrt(enl));
  var one = ee.Image.constant(1);

  var reducers = ee.Reducer.mean().combine({
    reducer2: ee.Reducer.variance(),
    sharedInputs: true
  });

  var stats = image.select(bandNames).reduceNeighborhood({
    reducer: reducers,
    kernel: ee.Kernel.square(kernelSize / 2, 'pixels'),
    optimization: 'window'
  });

  var meanBands = bandNames.map(function(b) {
    return ee.String(b).cat('_mean');
  });

  var varBands = bandNames.map(function(b) {
    return ee.String(b).cat('_variance');
  });

  var zBar = stats.select(meanBands).rename(bandNames);
  var varz = stats.select(varBands).rename(bandNames);

  var varx = varz.subtract(zBar.pow(2).multiply(eta.pow(2)))
    .divide(one.add(eta.pow(2)));

  var b = varx.divide(varz);
  var newB = b.where(b.lt(0), 0);

  var output = one.subtract(newB)
    .multiply(zBar.abs())
    .add(newB.multiply(image.select(bandNames)))
    .rename(bandNames);

  return image.addBands(output, null, true);
}


// ============================================================
// 3) OPTIONAL TERRAIN FLATTENING (Vollrath et al. style)
// ============================================================
function volumetricModelSCF(theta_iRad, alpha_rRad) {
  var ninetyRad = ee.Image.constant(Math.PI / 2);
  var nominator = ninetyRad.subtract(theta_iRad).add(alpha_rRad).tan();
  var denominator = ninetyRad.subtract(theta_iRad).tan();
  return nominator.divide(denominator);
}

function directModelSCF(theta_iRad, alpha_rRad, alpha_azRad) {
  var ninetyRad = ee.Image.constant(Math.PI / 2);
  var nominator = ninetyRad.subtract(theta_iRad).cos();
  var denominator = alpha_azRad.cos()
    .multiply(ninetyRad.subtract(theta_iRad).add(alpha_rRad).cos());
  return nominator.divide(denominator);
}

function erodeMask(maskImage, distance) {
  var d = maskImage.not().unmask(1)
    .fastDistanceTransform(30).sqrt()
    .multiply(ee.Image.pixelArea().sqrt());
  return maskImage.updateMask(d.gt(distance));
}

function layoverShadowMask(alpha_rRad, theta_iRad, bufferMeters) {
  var ninetyRad = ee.Image.constant(Math.PI / 2);
  var layover = alpha_rRad.lt(theta_iRad).rename('layover');
  var shadow = alpha_rRad.gt(ee.Image.constant(-1).multiply(ninetyRad.subtract(theta_iRad))).rename('shadow');
  var mask = layover.and(shadow);
  if (bufferMeters > 0) {
    mask = erodeMask(mask, bufferMeters);
  }
  return mask.rename('no_data_mask');
}

function terrainFlattening(collection, model, dem, bufferMeters) {
  return collection.map(function(image) {
    var geom = image.geometry();
    var proj = image.select('VV').projection();

    var elevation = dem
      .resample('bilinear')
      .reproject({crs: proj, scale: 10})
      .clip(geom);

    var heading = ee.Terrain.aspect(image.select('angle'))
      .reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: geom,
        scale: 1000,
        maxPixels: 1e8
      })
      .get('aspect');

    heading = ee.Number(heading)
      .where(ee.Number(heading).gt(180), ee.Number(heading).subtract(360));

    var theta_iRad = deg2rad(image.select('angle'));
    var phi_iRad = ee.Image.constant(heading).multiply(Math.PI / 180.0);

    var alpha_sRad = deg2rad(ee.Terrain.slope(elevation).select('slope'));
    var aspect = ee.Terrain.aspect(elevation).select('aspect').clip(geom);
    var aspectMinus = aspect.updateMask(aspect.gt(180)).subtract(360);

    var phi_sRad = aspect.updateMask(aspect.lte(180)).unmask()
      .add(aspectMinus.unmask())
      .multiply(-1)
      .multiply(Math.PI / 180.0);

    var phi_rRad = phi_iRad.subtract(phi_sRad);
    var alpha_rRad = alpha_sRad.tan().multiply(phi_rRad.cos()).atan();
    var alpha_azRad = alpha_sRad.tan().multiply(phi_rRad.sin()).atan();

    var gamma0 = image.select(['VV', 'VH']).divide(theta_iRad.cos());

    var scf = (model === 'VOLUME') ?
      volumetricModelSCF(theta_iRad, alpha_rRad) :
      directModelSCF(theta_iRad, alpha_rRad, alpha_azRad);

    var gamma0Flat = gamma0.multiply(scf);
    var mask = layoverShadowMask(alpha_rRad, theta_iRad, bufferMeters);

    var output = gamma0Flat
      .updateMask(mask)
      .rename(['VV', 'VH'])
      .copyProperties(image, image.propertyNames());

    output = ee.Image(output).addBands(image.select('angle'), null, true);

    return output.set('system:time_start', image.get('system:time_start'));
  });
}

function preprocessS1(collection) {
  var out = collection;
  if (USE_TERRAIN_FLATTENING) {
    out = terrainFlattening(
      out,
      TERRAIN_FLATTENING_MODEL,
      DEM,
      TERRAIN_FLATTENING_BUFFER_METERS
    );
  }
  out = out.map(leeFilter).map(toNaturalLog);
  return out;
}


// ============================================================
// 4) T-TEST CORE
// ============================================================
function computeTChange(pre, post, preN, postN) {
  var preMean = pre.mean().rename(['VV', 'VH']);
  var postMean = post.mean().rename(['VV', 'VH']);

  var preSd = pre.reduce(ee.Reducer.stdDev()).rename(['VV', 'VH']);
  var postSd = post.reduce(ee.Reducer.stdDev()).rename(['VV', 'VH']);

  var pooledSd = preSd.pow(2).multiply(preN.subtract(1))
    .add(postSd.pow(2).multiply(postN.subtract(1)))
    .divide(preN.add(postN).subtract(2))
    .sqrt();

  var denom = pooledSd.multiply(
    ee.Image.constant(1).divide(preN)
      .add(ee.Image.constant(1).divide(postN))
      .sqrt()
  );

  var change = postMean.subtract(preMean)
    .divide(denom)
    .abs()
    .rename(['VV', 'VH']);

  return change.updateMask(denom.gt(0));
}

function ttest(s1Prepared, inferenceStartDate, warStartDate, preMonths, postMonths) {
  var pre = s1Prepared.filterDate(
    warStartDate.advance(ee.Number(preMonths).multiply(-1), 'month'),
    warStartDate
  );

  var post = s1Prepared.filterDate(
    inferenceStartDate,
    inferenceStartDate.advance(postMonths, 'month')
  );

  // Kept consistent with the pasted Python implementation
  var preN = ee.Number(pre.aggregate_array('orbitNumber_start').distinct().size());
  var postN = ee.Number(post.aggregate_array('orbitNumber_start').distinct().size());

  var empty = ee.Image.constant([0, 0]).rename(['VV', 'VH'])
    .updateMask(ee.Image.constant(0));

  return ee.Image(ee.Algorithms.If(
    preN.gte(2).and(postN.gte(2)),
    computeTChange(pre, post, preN, postN),
    empty
  ));
}


// ============================================================
// 5) MAIN PWTT BUILDER
// ============================================================
function buildPWTT(aoiGeom, inferenceStartDate, warStartDate, preMonths, postMonths) {
  var s1All = getS1Base(aoiGeom)
    .filterDate(
      warStartDate.advance(-preMonths, 'month'),
      inferenceStartDate.advance(postMonths, 'month')
    );

  var s1InferenceRaw = s1All
    .filterDate(inferenceStartDate, inferenceStartDate.advance(postMonths, 'month'))
    .filter(ee.Filter.contains('.geo', ee.Feature(aoiGeom).geometry()));

  var orbitList = ee.List(
    s1InferenceRaw.aggregate_array('relativeOrbitNumber_start')
  ).distinct().sort();

  print('Relative orbits used:', orbitList);
  print('Reference raw image count:', s1All.filterDate(warStartDate.advance(-preMonths, 'month'), warStartDate).size());
  print('Inference raw image count:', s1InferenceRaw.size());

  var orbitImages = orbitList.map(function(orbit) {
    orbit = ee.Number(orbit);

    var s1OrbitRaw = s1All
      .filter(ee.Filter.eq('relativeOrbitNumber_start', orbit));

    var s1OrbitPrepared = preprocessS1(s1OrbitRaw);

    var tImg = ttest(
      s1OrbitPrepared,
      inferenceStartDate,
      warStartDate,
      preMonths,
      postMonths
    );

    return tImg.set('relativeOrbitNumber_start', orbit);
  });

  var orbitCollection = ee.ImageCollection.fromImages(orbitImages);
  var orbitMax = orbitCollection.max();

  var maxChange = orbitMax.select('VV')
    .max(orbitMax.select('VH'))
    .rename('max_change');

  var built = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(aoiGeom)
    .filterDate(warStartDate.advance(-preMonths, 'month'), warStartDate)
    .select('built')
    .mean()
    .rename('built');

  var base = maxChange
    .focalMedian(10, 'circle', 'meters')
    .clip(aoiGeom)
    .updateMask(built.gt(builtThreshold))
    .rename('max_change');

  var k50 = base.convolve(ee.Kernel.circle(50, 'meters', true)).rename('k50');
  var k100 = base.convolve(ee.Kernel.circle(100, 'meters', true)).rename('k100');
  var k150 = base.convolve(ee.Kernel.circle(150, 'meters', true)).rename('k150');

  var damage = base.gt(rasterDamageThreshold).rename('damage').toFloat();

  var tStatistic = base
    .add(k50)
    .add(k100)
    .add(k150)
    .divide(4)
    .rename('T_statistic');

  return ee.Image.cat([
    tStatistic.toFloat(),
    damage,
    base.toFloat(),
    built.toFloat(),
    k50.toFloat(),
    k100.toFloat(),
    k150.toFloat()
  ]).clip(aoiGeom);
}


// ============================================================
// 6) FOOTPRINT HELPERS (client-side asset discovery where useful)
// ============================================================
function listAssetNames(parent) {
  var resp = ee.data.listAssets(parent);
  if (!resp || !resp.assets) return [];
  return resp.assets.map(function(a) { return a.name; });
}

function findFirstAssetContaining(parent, fragments) {
  var names = listAssetNames(parent);
  var lowerNames = names.map(function(n) { return n.toLowerCase(); });

  for (var i = 0; i < fragments.length; i++) {
    var frag = String(fragments[i]).toLowerCase();
    for (var j = 0; j < names.length; j++) {
      if (lowerNames[j].indexOf(frag) !== -1) {
        return names[j];
      }
    }
  }
  return null;
}

function normalizeFootprints(fc, sourceLabel, aoiGeom) {
  return ee.FeatureCollection(fc)
    .filterBounds(aoiGeom)
    .map(function(f) {
      var props = f.propertyNames();

      var areaM2 = ee.Number(ee.Algorithms.If(
        props.contains('area_in_meters'),
        f.get('area_in_meters'),
        ee.Algorithms.If(
          props.contains('area'),
          f.get('area'),
          f.geometry().area(1)
        )
      ));

      return ee.Feature(f.geometry())
        .copyProperties(f)
        .set({
          area_m2: areaM2,
          footprint_source: sourceLabel
        });
    })
    .filter(ee.Filter.gt('area_m2', minBuildingAreaM2));
}

function loadVidaCombined(aoiGeom) {
  var assetId = 'projects/sat-io/open-datasets/VIDA_COMBINED/' + COUNTRY_ISO3;
  return normalizeFootprints(ee.FeatureCollection(assetId), 'VIDA_COMBINED', aoiGeom);
}

function loadMsBuildingsAuto(aoiGeom) {
  var parent = 'projects/sat-io/open-datasets/MSBuildings';
  var assetId = findFirstAssetContaining(parent, ['palest', 'pse', 'gaza']);
  if (!assetId) {
    throw new Error('Could not auto-discover a Palestine/Gaza MSBuildings asset under: ' + parent);
  }
  print('MSBuildings asset selected:', assetId);
  return normalizeFootprints(ee.FeatureCollection(assetId), 'MSBUILDINGS_AUTO', aoiGeom);
}

function loadGhsObatAuto(aoiGeom) {
  var parent = 'projects/sat-io/open-datasets/JRC/GHS-OBAT';
  var assetId = findFirstAssetContaining(parent, ['_PSE_', 'PALEST', 'Gaza']);
  if (!assetId) {
    throw new Error('Could not auto-discover a Palestine/Gaza GHS-OBAT asset under: ' + parent);
  }
  print('GHS-OBAT asset selected:', assetId);
  return normalizeFootprints(ee.FeatureCollection(assetId), 'GHS_OBAT_AUTO', aoiGeom);
}

function loadOBM(aoiGeom) {
  var grid = ee.FeatureCollection('projects/sat-io/open-datasets/OPEN-BUILDING-MAPS/open_buildings_grid')
    .filterBounds(aoiGeom);

  var quadkeys = ee.List(grid.aggregate_array('quadkey')).distinct().getInfo();
  if (!quadkeys || !quadkeys.length) {
    throw new Error('No OBM quadkeys intersect the AOI.');
  }

  print('OBM quadkeys:', quadkeys);

  var merged = ee.FeatureCollection([]);
  quadkeys.forEach(function(qk) {
    var fc = ee.FeatureCollection(
      'projects/sat-io/open-datasets/OPEN-BUILDING-MAPS/tiles/building_' + qk
    );
    merged = merged.merge(fc);
  });

  return normalizeFootprints(merged, 'OBM', aoiGeom);
}

function loadGoogleOpenBuildings(aoiGeom) {
  var fc = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
    .filterBounds(aoiGeom);
  return normalizeFootprints(fc, 'GOOGLE_OPEN_BUILDINGS', aoiGeom);
}

function loadCustomFootprints(aoiGeom) {
  if (!CUSTOM_FOOTPRINT_ASSET) {
    throw new Error('CUSTOM_FOOTPRINT_ASSET is empty.');
  }
  return normalizeFootprints(
    ee.FeatureCollection(CUSTOM_FOOTPRINT_ASSET),
    'CUSTOM',
    aoiGeom
  );
}

function getFootprints(aoiGeom) {
  if (FOOTPRINT_SOURCE === 'VIDA_COMBINED') return loadVidaCombined(aoiGeom);
  if (FOOTPRINT_SOURCE === 'MSBUILDINGS_AUTO') return loadMsBuildingsAuto(aoiGeom);
  if (FOOTPRINT_SOURCE === 'GHS_OBAT_AUTO') return loadGhsObatAuto(aoiGeom);
  if (FOOTPRINT_SOURCE === 'OBM') return loadOBM(aoiGeom);
  if (FOOTPRINT_SOURCE === 'GOOGLE_OPEN_BUILDINGS') return loadGoogleOpenBuildings(aoiGeom);
  if (FOOTPRINT_SOURCE === 'CUSTOM') return loadCustomFootprints(aoiGeom);

  throw new Error('Unsupported FOOTPRINT_SOURCE: ' + FOOTPRINT_SOURCE);
}


// ============================================================
// 7) BUILDING-LEVEL SUMMARY
// ============================================================
function summarizeByBuildings(pwttImage, footprints) {
  var stats = pwttImage.select('T_statistic').reduceRegions({
    collection: footprints,
    reducer: ee.Reducer.mean(),
    scale: 10,
    tileScale: 4
  });

  stats = stats.filter(ee.Filter.notNull(['mean']))
    .map(function(f) {
      var meanT = ee.Number(f.get('mean'));
      var damagedInt = ee.Number(ee.Algorithms.If(
        meanT.gt(buildingDamageThreshold), 1, 0
      ));
      return f.set({
        mean_T: meanT,
        damaged_int: damagedInt
      });
    });

  return stats;
}


// ============================================================
// 8) RUN PWTT
// ============================================================
var result = buildPWTT(
  aoi,
  inferenceStart,
  warStart,
  preIntervalMonths,
  postIntervalMonths
);

print('PWTT result image:', result);


// ============================================================
// 9) VISUALIZATION
// ============================================================
var tVis = {
  min: 2.5,
  max: 5.5,
  palette: ['0015ff', '00d4ff', 'ffff00', 'ff4b00', '6a00ff']
};

var builtVis = {
  min: 0,
  max: 0.5,
  palette: ['000000', 'ffffff']
};

Map.addLayer(ee.Image().paint(aoi, 1, 2), {palette: ['ffffff']}, 'AOI', true, 0.9);
Map.addLayer(result.select('T_statistic'), tVis, 'PWTT T_statistic', true);
Map.addLayer(result.select('max_change'), tVis, 'PWTT max_change', false);
Map.addLayer(result.select('damage').selfMask(), {palette: ['ff0000']}, 'Damage > threshold', true);
Map.addLayer(result.select('built'), builtVis, 'Dynamic World built mean', false);


// ============================================================
// 10) OPTIONAL FOOTPRINT WORKFLOW
// ============================================================
if (USE_FOOTPRINTS) {
  if (FOOTPRINT_SOURCE === 'GOOGLE_OPEN_BUILDINGS') {
    print('Note: GOOGLE_OPEN_BUILDINGS is supported by the script, but Gaza is outside the official published coverage of that dataset.');
  }

  var footprints = getFootprints(aoi);
  print('Footprints collection preview:', footprints.limit(3));
  print('Footprint count after filters:', footprints.size());

  // Simple preview of raw footprints
  var footprintPreview = footprints.limit(DISPLAY_MAX_FOOTPRINTS);
  Map.addLayer(
    footprintPreview.style({
      color: '00ffff',
      fillColor: '00000000',
      width: 1
    }),
    {},
    'Footprints preview',
    false
  );

  if (RUN_FOOTPRINT_ZONAL_STATS) {
    var buildingStats = summarizeByBuildings(result, footprints);

    var totalBuildings = buildingStats.size();
    var damagedBuildings = buildingStats.filter(ee.Filter.eq('damaged_int', 1)).size();

    print('Buildings with valid mean T:', totalBuildings);
    print('Predicted damaged buildings:', damagedBuildings);
    print('Predicted damage share:', ee.Number(damagedBuildings).divide(totalBuildings));

    var previewStats = buildingStats.limit(DISPLAY_MAX_FOOTPRINTS);

    Map.addLayer(
      previewStats.filter(ee.Filter.eq('damaged_int', 0)).style({
        color: '00ffff',
        fillColor: '00000000',
        width: 1
      }),
      {},
      'Buildings undamaged (preview)',
      false
    );

    Map.addLayer(
      previewStats.filter(ee.Filter.eq('damaged_int', 1)).style({
        color: 'ff0000',
        fillColor: 'ff000022',
        width: 1
      }),
      {},
      'Buildings damaged (preview)',
      true
    );

    if (EXPORT_BUILDING_TABLE) {
      Export.table.toDrive({
        collection: buildingStats,
        description: 'PWTT_Gaza_BuildingStats_' + FOOTPRINT_SOURCE,
        folder: EXPORT_FOLDER,
        fileFormat: 'CSV'
      });
    }
  }
}


// ============================================================
// 11) OPTIONAL RASTER EXPORTS
// ============================================================
if (EXPORT_RASTER) {
  Export.image.toDrive({
    image: result.select('T_statistic'),
    description: 'PWTT_Gaza_TStatistic_2024_07',
    folder: EXPORT_FOLDER,
    region: aoi,
    scale: 10,
    maxPixels: 1e13
  });

  Export.image.toDrive({
    image: result.select('damage'),
    description: 'PWTT_Gaza_DamageBinary_2024_07',
    folder: EXPORT_FOLDER,
    region: aoi,
    scale: 10,
    maxPixels: 1e13
  });
}
