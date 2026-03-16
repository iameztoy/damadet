/**** 
 * PWTT Earth Engine App
 * Gaza example
 * English UI
 *
 * Notes:
 * 1) Community building-footprint asset paths may need adjustment in your catalog.
 * 2) Google Open Buildings is included, but Gaza may not be covered there.
 * 3) This script is intended for the Earth Engine Code Editor and can be published as an App.
 ****/


// ============================================================
// 0) APP ROOT
// ============================================================
ui.root.clear();

var map = ui.Map();
map.setOptions('SATELLITE');
map.style().set('cursor', 'crosshair');

var appPanel = ui.Panel({
  style: {
    width: '420px',
    padding: '10px'
  }
});

var splitPanel = ui.SplitPanel({
  firstPanel: appPanel,
  secondPanel: map,
  orientation: 'horizontal',
  wipe: false,
  style: {stretch: 'both'}
});

ui.root.add(splitPanel);


// ============================================================
// 1) DEFAULT AOIS
// ============================================================
var AOI_PRESETS = {
  'Full Gaza': ee.Geometry.Rectangle([34.21, 31.21, 34.57, 31.60], null, false),
  'North Gaza test': ee.Geometry.Rectangle([34.38, 31.48, 34.50, 31.58], null, false)
};

map.centerObject(AOI_PRESETS['Full Gaza'], 10);


// ============================================================
// 2) DRAWING TOOLS
// ============================================================
var drawingTools = map.drawingTools();
drawingTools.setShown(false);

function clearDrawings() {
  var layers = drawingTools.layers();
  while (layers.length() > 0) {
    layers.remove(layers.get(0));
  }
}

function enableDrawing() {
  drawingTools.setShown(true);
  drawingTools.setShape('polygon');
  clearDrawings();
}

function disableDrawing() {
  drawingTools.setShown(false);
}

function getSelectedAoi() {
  var aoiMode = aoiSelect.getValue();

  if (aoiMode === 'Draw AOI') {
    var layers = drawingTools.layers();
    if (layers.length() === 0) {
      throw new Error('Please draw a polygon or rectangle on the map first.');
    }
    return ee.Geometry(layers.get(0).getEeObject());
  }

  return AOI_PRESETS[aoiMode];
}


// ============================================================
// 3) UI HELPERS
// ============================================================
function makeSectionTitle(text) {
  return ui.Label(text, {
    fontWeight: 'bold',
    fontSize: '13px',
    margin: '10px 0 4px 0'
  });
}

function makeSmallLabel(text) {
  return ui.Label(text, {
    fontSize: '11px',
    color: '#666666',
    margin: '0 0 6px 0'
  });
}

function makeColorRow(color, label) {
  return ui.Panel({
    widgets: [
      ui.Label('', {
        backgroundColor: color,
        padding: '8px',
        margin: '0 8px 4px 0'
      }),
      ui.Label(label, {fontSize: '11px', margin: '0 0 4px 0'})
    ],
    layout: ui.Panel.Layout.Flow('horizontal')
  });
}

function setStatus(msg, color) {
  statusLabel.style().set('color', color || '#1d4ed8');
  statusLabel.setValue(msg);
}

function resetSummary() {
  summaryLabel.setValue('Summary: not computed yet.');
  buildingsLabel.setValue('Buildings: n/a');
  damagedLabel.setValue('Predicted damaged buildings: n/a');
  shareLabel.setValue('Predicted damage share: n/a');
}


// ============================================================
// 4) APP HEADER
// ============================================================
var title = ui.Label('PWTT Damage Detection App', {
  fontWeight: 'bold',
  fontSize: '20px',
  margin: '0 0 6px 0'
});

var subtitle = ui.Label(
  'Interactive Google Earth Engine app for PWTT/PWZS over Gaza with optional terrain flattening and building-level summarization.',
  {
    fontSize: '12px',
    color: '#444444',
    margin: '0 0 12px 0'
  }
);

appPanel.add(title);
appPanel.add(subtitle);


// ============================================================
// 5) INPUT WIDGETS
// ============================================================

// AOI
appPanel.add(makeSectionTitle('1) Area of interest'));

var aoiSelect = ui.Select({
  items: ['Full Gaza', 'North Gaza test', 'Draw AOI'],
  value: 'Full Gaza',
  style: {stretch: 'horizontal'}
});

var drawButton = ui.Button({
  label: 'Start drawing AOI',
  onClick: function() {
    enableDrawing();
    setStatus('Drawing mode enabled. Draw a polygon or rectangle on the map.', '#7c3aed');
  },
  style: {stretch: 'horizontal'}
});

var clearDrawButton = ui.Button({
  label: 'Clear drawn AOI',
  onClick: function() {
    clearDrawings();
    setStatus('Drawn AOI cleared.', '#6b7280');
  },
  style: {stretch: 'horizontal'}
});

aoiSelect.onChange(function(value) {
  if (value === 'Draw AOI') {
    enableDrawing();
    setStatus('Draw an AOI on the map, then click Run.', '#7c3aed');
  } else {
    disableDrawing();
    map.centerObject(AOI_PRESETS[value], value === 'Full Gaza' ? 10 : 13);
  }
});

appPanel.add(aoiSelect);
appPanel.add(makeSmallLabel('Choose a preset or draw your own AOI.'));
appPanel.add(drawButton);
appPanel.add(clearDrawButton);


// Dates and mode
appPanel.add(makeSectionTitle('2) Time settings'));

var modeSelect = ui.Select({
  items: ['PWTT (1-month inference)', 'PWZS (single post-event image)'],
  value: 'PWTT (1-month inference)',
  style: {stretch: 'horizontal'}
});

var warStartBox = ui.Textbox({
  placeholder: 'YYYY-MM-DD',
  value: '2023-10-10',
  style: {stretch: 'horizontal'}
});

var inferenceStartBox = ui.Textbox({
  placeholder: 'YYYY-MM-DD',
  value: '2024-07-01',
  style: {stretch: 'horizontal'}
});

var preMonthsBox = ui.Textbox({
  placeholder: '12',
  value: '12',
  style: {stretch: 'horizontal'}
});

var postMonthsBox = ui.Textbox({
  placeholder: '1',
  value: '1',
  style: {stretch: 'horizontal'}
});

appPanel.add(ui.Label('Mode'));
appPanel.add(modeSelect);
appPanel.add(ui.Label('War start date'));
appPanel.add(warStartBox);
appPanel.add(ui.Label('Inference start date'));
appPanel.add(inferenceStartBox);
appPanel.add(ui.Label('Pre-event months'));
appPanel.add(preMonthsBox);
appPanel.add(ui.Label('Post-event months'));
appPanel.add(postMonthsBox);
appPanel.add(makeSmallLabel('PWTT uses a post-event inference window. PWZS uses the first available post-event image.'));


// Thresholds
appPanel.add(makeSectionTitle('3) Thresholds'));

var builtSlider = ui.Slider({
  min: 0,
  max: 0.5,
  value: 0.10,
  step: 0.01,
  style: {stretch: 'horizontal'}
});

var rasterThresholdSlider = ui.Slider({
  min: 2.0,
  max: 5.0,
  value: 3.0,
  step: 0.1,
  style: {stretch: 'horizontal'}
});

var buildingThresholdSlider = ui.Slider({
  min: 2.0,
  max: 5.0,
  value: 3.2,
  step: 0.1,
  style: {stretch: 'horizontal'}
});

var minAreaBox = ui.Textbox({
  placeholder: '50',
  value: '50',
  style: {stretch: 'horizontal'}
});

appPanel.add(ui.Label('Built-up mask threshold'));
appPanel.add(builtSlider);
appPanel.add(ui.Label('Raster damage threshold'));
appPanel.add(rasterThresholdSlider);
appPanel.add(ui.Label('Building mean-T damage threshold'));
appPanel.add(buildingThresholdSlider);
appPanel.add(ui.Label('Minimum building area (m²)'));
appPanel.add(minAreaBox);


// Terrain flattening
appPanel.add(makeSectionTitle('4) Terrain flattening'));

var useTerrainCheck = ui.Checkbox({
  label: 'Enable terrain flattening',
  value: false
});

var terrainModelSelect = ui.Select({
  items: ['DIRECT', 'VOLUME'],
  value: 'DIRECT',
  style: {stretch: 'horizontal'}
});

var terrainBufferBox = ui.Textbox({
  placeholder: '30',
  value: '30',
  style: {stretch: 'horizontal'}
});

appPanel.add(useTerrainCheck);
appPanel.add(ui.Label('RTF model'));
appPanel.add(terrainModelSelect);
appPanel.add(ui.Label('Layover/shadow buffer (m)'));
appPanel.add(terrainBufferBox);
appPanel.add(makeSmallLabel('Recommended mainly for rugged terrain, not usually necessary in flat urban settings.'));


// Footprints
appPanel.add(makeSectionTitle('5) Building footprints'));

var useFootprintsCheck = ui.Checkbox({
  label: 'Enable building footprints',
  value: false
});

var runZonalCheck = ui.Checkbox({
  label: 'Compute building-level mean T',
  value: false
});

var footprintSourceSelect = ui.Select({
  items: [
    'VIDA_COMBINED',
    'MSBUILDINGS_AUTO',
    'GHS_OBAT_AUTO',
    'OBM',
    'GOOGLE_OPEN_BUILDINGS',
    'CUSTOM'
  ],
  value: 'VIDA_COMBINED',
  style: {stretch: 'horizontal'}
});

var iso3Box = ui.Textbox({
  placeholder: 'PSE',
  value: 'PSE',
  style: {stretch: 'horizontal'}
});

var customAssetBox = ui.Textbox({
  placeholder: 'users/you/your_buildings_asset',
  value: '',
  style: {stretch: 'horizontal'}
});

appPanel.add(useFootprintsCheck);
appPanel.add(runZonalCheck);
appPanel.add(ui.Label('Footprint source'));
appPanel.add(footprintSourceSelect);
appPanel.add(ui.Label('Country ISO3 (for VIDA)'));
appPanel.add(iso3Box);
appPanel.add(ui.Label('Custom footprint asset'));
appPanel.add(customAssetBox);
appPanel.add(makeSmallLabel('If a community dataset path does not resolve in your account, use CUSTOM as fallback.'));


// Visualization
appPanel.add(makeSectionTitle('6) Layers'));

var showTstatCheck = ui.Checkbox({label: 'Show T-statistic', value: true});
var showMaxCheck = ui.Checkbox({label: 'Show max_change', value: false});
var showDamageCheck = ui.Checkbox({label: 'Show binary damage', value: true});
var showBuiltCheck = ui.Checkbox({label: 'Show built-up mask', value: false});
var showFootprintCheck = ui.Checkbox({label: 'Show footprint outlines', value: false});

appPanel.add(showTstatCheck);
appPanel.add(showMaxCheck);
appPanel.add(showDamageCheck);
appPanel.add(showBuiltCheck);
appPanel.add(showFootprintCheck);


// Buttons
appPanel.add(makeSectionTitle('7) Actions'));

var runButton = ui.Button({
  label: 'Run analysis',
  style: {
    stretch: 'horizontal',
    color: 'white',
    backgroundColor: '#2563eb'
  }
});

var resetMapButton = ui.Button({
  label: 'Reset map',
  style: {stretch: 'horizontal'}
});

appPanel.add(runButton);
appPanel.add(resetMapButton);


// Status and summary
appPanel.add(makeSectionTitle('8) Status'));

var statusLabel = ui.Label('Ready.', {
  fontSize: '12px',
  color: '#1d4ed8',
  margin: '0 0 8px 0'
});

var summaryLabel = ui.Label('Summary: not computed yet.', {fontSize: '12px'});
var buildingsLabel = ui.Label('Buildings: n/a', {fontSize: '12px'});
var damagedLabel = ui.Label('Predicted damaged buildings: n/a', {fontSize: '12px'});
var shareLabel = ui.Label('Predicted damage share: n/a', {fontSize: '12px'});

appPanel.add(statusLabel);
appPanel.add(summaryLabel);
appPanel.add(buildingsLabel);
appPanel.add(damagedLabel);
appPanel.add(shareLabel);


// Legend
appPanel.add(makeSectionTitle('9) Legend'));

var legendPanel = ui.Panel({style: {margin: '0 0 8px 0'}});
legendPanel.add(ui.Label('PWTT / PWZS T-statistic', {fontWeight: 'bold', fontSize: '12px'}));
legendPanel.add(makeColorRow('#0015ff', 'Low change'));
legendPanel.add(makeColorRow('#00d4ff', 'Moderate change'));
legendPanel.add(makeColorRow('#ffff00', 'Elevated change'));
legendPanel.add(makeColorRow('#ff4b00', 'High change'));
legendPanel.add(makeColorRow('#6a00ff', 'Very high change'));

legendPanel.add(ui.Label('Binary damage', {fontWeight: 'bold', fontSize: '12px', margin: '8px 0 0 0'}));
legendPanel.add(makeColorRow('#ff0000', 'Predicted damaged'));

legendPanel.add(ui.Label('Built-up mask', {fontWeight: 'bold', fontSize: '12px', margin: '8px 0 0 0'}));
legendPanel.add(makeColorRow('#000000', 'Low built probability'));
legendPanel.add(makeColorRow('#ffffff', 'High built probability'));

legendPanel.add(ui.Label(
  'Interpretation: higher T-values indicate stronger statistically significant change. Building-level prediction is based on mean T inside each footprint.',
  {fontSize: '11px', color: '#555555', margin: '8px 0 0 0'}
));

appPanel.add(legendPanel);


// ============================================================
// 6) GENERAL HELPERS
// ============================================================
function deg2rad(img) {
  return img.multiply(Math.PI / 180.0);
}

function getNumberFromBox(box, fallback) {
  var value = Number(box.getValue());
  return isNaN(value) ? fallback : value;
}

function getS1Base(aoiGeom, startDate, endDate) {
  return ee.ImageCollection('COPERNICUS/S1_GRD_FLOAT')
    .filterBounds(aoiGeom)
    .filterDate(startDate, endDate)
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
// 7) LEE FILTER
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
// 8) TERRAIN FLATTENING
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

function preprocessS1(collection, useTerrain, terrainModel, terrainBuffer) {
  var dem = ee.Image('COPERNICUS/DEM/GLO30').select('DEM');
  var out = collection;

  if (useTerrain) {
    out = terrainFlattening(out, terrainModel, dem, terrainBuffer);
  }

  out = out.map(leeFilter).map(toNaturalLog);
  return out;
}


// ============================================================
// 9) PWTT / PWZS CORE
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

function zscoreSingleImage(preparedCollection, inferenceStartDate, warStartDate, preMonths) {
  var pre = preparedCollection.filterDate(
    warStartDate.advance(ee.Number(preMonths).multiply(-1), 'month'),
    warStartDate
  );

  var postFirst = preparedCollection
    .filterDate(inferenceStartDate, inferenceStartDate.advance(1, 'month'))
    .sort('system:time_start')
    .first();

  var preMean = pre.mean().rename(['VV', 'VH']);
  var preSd = pre.reduce(ee.Reducer.stdDev()).rename(['VV', 'VH']);
  var postImg = ee.Image(postFirst).select(['VV', 'VH']).rename(['VV', 'VH']);

  var z = postImg.subtract(preMean).divide(preSd).abs().rename(['VV', 'VH']);
  return z.updateMask(preSd.gt(0));
}

function finalizeChangeImage(changeImage, aoiGeom, warStartDate, preMonths, builtThreshold, rasterThreshold) {
  var built = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(aoiGeom)
    .filterDate(warStartDate.advance(-preMonths, 'month'), warStartDate)
    .select('built')
    .mean()
    .rename('built');

  var maxChange = changeImage.select('VV')
    .max(changeImage.select('VH'))
    .rename('max_change');

  var base = maxChange
    .focalMedian(10, 'circle', 'meters')
    .clip(aoiGeom)
    .updateMask(built.gt(builtThreshold))
    .rename('max_change');

  var k50 = base.convolve(ee.Kernel.circle(50, 'meters', true)).rename('k50');
  var k100 = base.convolve(ee.Kernel.circle(100, 'meters', true)).rename('k100');
  var k150 = base.convolve(ee.Kernel.circle(150, 'meters', true)).rename('k150');

  var tStatistic = base.add(k50).add(k100).add(k150).divide(4).rename('T_statistic');
  var damage = tStatistic.gt(rasterThreshold).rename('damage').toFloat();

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

function buildPWTT(aoiGeom, inferenceStartDate, warStartDate, preMonths, postMonths, useTerrain, terrainModel, terrainBuffer, builtThreshold, rasterThreshold) {
  var startDate = warStartDate.advance(-preMonths, 'month');
  var endDate = inferenceStartDate.advance(postMonths, 'month');

  var s1All = getS1Base(aoiGeom, startDate, endDate);
  var s1InferenceRaw = s1All.filterDate(inferenceStartDate, inferenceStartDate.advance(postMonths, 'month'));

  var orbitList = ee.List(
    s1InferenceRaw.aggregate_array('relativeOrbitNumber_start')
  ).distinct().sort();

  var orbitImages = orbitList.map(function(orbit) {
    orbit = ee.Number(orbit);

    var s1OrbitRaw = s1All
      .filter(ee.Filter.eq('relativeOrbitNumber_start', orbit));

    var s1OrbitPrepared = preprocessS1(s1OrbitRaw, useTerrain, terrainModel, terrainBuffer);

    return ttest(s1OrbitPrepared, inferenceStartDate, warStartDate, preMonths, postMonths)
      .set('relativeOrbitNumber_start', orbit);
  });

  var orbitCollection = ee.ImageCollection.fromImages(orbitImages);
  var orbitMax = orbitCollection.max();

  return finalizeChangeImage(orbitMax, aoiGeom, warStartDate, preMonths, builtThreshold, rasterThreshold);
}

function buildPWZS(aoiGeom, inferenceStartDate, warStartDate, preMonths, useTerrain, terrainModel, terrainBuffer, builtThreshold, rasterThreshold) {
  var startDate = warStartDate.advance(-preMonths, 'month');
  var endDate = inferenceStartDate.advance(1, 'month');

  var s1All = getS1Base(aoiGeom, startDate, endDate);
  var s1InferenceRaw = s1All.filterDate(inferenceStartDate, inferenceStartDate.advance(1, 'month'));

  var orbitList = ee.List(
    s1InferenceRaw.aggregate_array('relativeOrbitNumber_start')
  ).distinct().sort();

  var orbitImages = orbitList.map(function(orbit) {
    orbit = ee.Number(orbit);

    var s1OrbitRaw = s1All
      .filter(ee.Filter.eq('relativeOrbitNumber_start', orbit));

    var s1OrbitPrepared = preprocessS1(s1OrbitRaw, useTerrain, terrainModel, terrainBuffer);

    return zscoreSingleImage(s1OrbitPrepared, inferenceStartDate, warStartDate, preMonths)
      .set('relativeOrbitNumber_start', orbit);
  });

  var orbitCollection = ee.ImageCollection.fromImages(orbitImages);
  var orbitMax = orbitCollection.max();

  return finalizeChangeImage(orbitMax, aoiGeom, warStartDate, preMonths, builtThreshold, rasterThreshold);
}


// ============================================================
// 10) FOOTPRINT HELPERS
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

function normalizeFootprints(fc, sourceLabel, aoiGeom, minAreaM2) {
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
    .filter(ee.Filter.gt('area_m2', minAreaM2));
}

function loadVidaCombined(aoiGeom, iso3, minAreaM2) {
  var assetId = 'projects/sat-io/open-datasets/VIDA_COMBINED/' + iso3;
  return normalizeFootprints(ee.FeatureCollection(assetId), 'VIDA_COMBINED', aoiGeom, minAreaM2);
}

function loadMsBuildingsAuto(aoiGeom, minAreaM2) {
  var parent = 'projects/sat-io/open-datasets/MSBuildings';
  var assetId = findFirstAssetContaining(parent, ['palest', 'pse', 'gaza']);
  if (!assetId) {
    throw new Error('Could not auto-discover a Palestine/Gaza MSBuildings asset under ' + parent);
  }
  return normalizeFootprints(ee.FeatureCollection(assetId), 'MSBUILDINGS_AUTO', aoiGeom, minAreaM2);
}

function loadGhsObatAuto(aoiGeom, minAreaM2) {
  var parent = 'projects/sat-io/open-datasets/JRC/GHS-OBAT';
  var assetId = findFirstAssetContaining(parent, ['_pse_', 'palest', 'gaza']);
  if (!assetId) {
    throw new Error('Could not auto-discover a Palestine/Gaza GHS-OBAT asset under ' + parent);
  }
  return normalizeFootprints(ee.FeatureCollection(assetId), 'GHS_OBAT_AUTO', aoiGeom, minAreaM2);
}

function loadOBM(aoiGeom, minAreaM2) {
  var grid = ee.FeatureCollection('projects/sat-io/open-datasets/OPEN-BUILDING-MAPS/open_buildings_grid')
    .filterBounds(aoiGeom);

  var quadkeys = ee.List(grid.aggregate_array('quadkey')).distinct().getInfo();
  if (!quadkeys || !quadkeys.length) {
    throw new Error('No OBM quadkeys intersect the AOI.');
  }

  var merged = ee.FeatureCollection([]);
  quadkeys.forEach(function(qk) {
    var fc = ee.FeatureCollection(
      'projects/sat-io/open-datasets/OPEN-BUILDING-MAPS/tiles/building_' + qk
    );
    merged = merged.merge(fc);
  });

  return normalizeFootprints(merged, 'OBM', aoiGeom, minAreaM2);
}

function loadGoogleOpenBuildings(aoiGeom, minAreaM2) {
  var fc = ee.FeatureCollection('GOOGLE/Research/open-buildings/v3/polygons')
    .filterBounds(aoiGeom);
  return normalizeFootprints(fc, 'GOOGLE_OPEN_BUILDINGS', aoiGeom, minAreaM2);
}

function loadCustomFootprints(aoiGeom, assetId, minAreaM2) {
  if (!assetId) {
    throw new Error('Custom footprint asset is empty.');
  }
  return normalizeFootprints(ee.FeatureCollection(assetId), 'CUSTOM', aoiGeom, minAreaM2);
}

function getFootprints(aoiGeom, source, iso3, customAsset, minAreaM2) {
  if (source === 'VIDA_COMBINED') return loadVidaCombined(aoiGeom, iso3, minAreaM2);
  if (source === 'MSBUILDINGS_AUTO') return loadMsBuildingsAuto(aoiGeom, minAreaM2);
  if (source === 'GHS_OBAT_AUTO') return loadGhsObatAuto(aoiGeom, minAreaM2);
  if (source === 'OBM') return loadOBM(aoiGeom, minAreaM2);
  if (source === 'GOOGLE_OPEN_BUILDINGS') return loadGoogleOpenBuildings(aoiGeom, minAreaM2);
  if (source === 'CUSTOM') return loadCustomFootprints(aoiGeom, customAsset, minAreaM2);

  throw new Error('Unsupported footprint source: ' + source);
}

function summarizeByBuildings(resultImage, footprints, buildingThreshold) {
  var stats = resultImage.select('T_statistic').reduceRegions({
    collection: footprints,
    reducer: ee.Reducer.mean(),
    scale: 10,
    tileScale: 4
  });

  stats = stats.filter(ee.Filter.notNull(['mean']))
    .map(function(f) {
      var meanT = ee.Number(f.get('mean'));
      var damagedInt = ee.Number(ee.Algorithms.If(meanT.gt(buildingThreshold), 1, 0));
      return f.set({
        mean_T: meanT,
        damaged_int: damagedInt
      });
    });

  return stats;
}


// ============================================================
// 11) VISUALIZATION
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

function resetMapLayers() {
  map.layers().reset();
}

function drawResultLayers(aoiGeom, resultImage, footprints, buildingStats) {
  resetMapLayers();

  map.addLayer(ee.Image().paint(aoiGeom, 1, 2), {palette: ['ffffff']}, 'AOI', true, 0.9);

  if (showTstatCheck.getValue()) {
    map.addLayer(resultImage.select('T_statistic'), tVis, 'T-statistic', true);
  }

  if (showMaxCheck.getValue()) {
    map.addLayer(resultImage.select('max_change'), tVis, 'max_change', false);
  }

  if (showDamageCheck.getValue()) {
    map.addLayer(resultImage.select('damage').selfMask(), {palette: ['ff0000']}, 'Binary damage', true);
  }

  if (showBuiltCheck.getValue()) {
    map.addLayer(resultImage.select('built'), builtVis, 'Built-up mask', false);
  }

  if (footprints && showFootprintCheck.getValue()) {
    map.addLayer(
      footprints.style({
        color: '00ffff',
        fillColor: '00000000',
        width: 1
      }),
      {},
      'Footprints',
      false
    );
  }

  if (buildingStats) {
    map.addLayer(
      buildingStats.filter(ee.Filter.eq('damaged_int', 1)).style({
        color: 'ff0000',
        fillColor: 'ff000022',
        width: 1
      }),
      {},
      'Predicted damaged buildings',
      true
    );

    map.addLayer(
      buildingStats.filter(ee.Filter.eq('damaged_int', 0)).style({
        color: '00ffff',
        fillColor: '00000000',
        width: 1
      }),
      {},
      'Predicted undamaged buildings',
      false
    );
  }
}


// ============================================================
// 12) RUNNER
// ============================================================
function runAnalysis() {
  resetSummary();

  try {
    setStatus('Preparing inputs...', '#1d4ed8');

    var aoiGeom = getSelectedAoi();

    var warStart = ee.Date(warStartBox.getValue());
    var inferenceStart = ee.Date(inferenceStartBox.getValue());
    var preMonths = getNumberFromBox(preMonthsBox, 12);
    var postMonths = getNumberFromBox(postMonthsBox, 1);
    var builtThreshold = builtSlider.getValue();
    var rasterThreshold = rasterThresholdSlider.getValue();
    var buildingThreshold = buildingThresholdSlider.getValue();
    var minAreaM2 = getNumberFromBox(minAreaBox, 50);
    var useTerrain = useTerrainCheck.getValue();
    var terrainModel = terrainModelSelect.getValue();
    var terrainBuffer = getNumberFromBox(terrainBufferBox, 30);
    var useFootprints = useFootprintsCheck.getValue();
    var runZonal = runZonalCheck.getValue();
    var source = footprintSourceSelect.getValue();
    var iso3 = iso3Box.getValue();
    var customAsset = customAssetBox.getValue();
    var mode = modeSelect.getValue();

    setStatus('Running image analysis...', '#1d4ed8');

    var result = (mode === 'PWZS (single post-event image)') ?
      buildPWZS(aoiGeom, inferenceStart, warStart, preMonths, useTerrain, terrainModel, terrainBuffer, builtThreshold, rasterThreshold) :
      buildPWTT(aoiGeom, inferenceStart, warStart, preMonths, postMonths, useTerrain, terrainModel, terrainBuffer, builtThreshold, rasterThreshold);

    map.centerObject(aoiGeom, aoiSelect.getValue() === 'Full Gaza' ? 10 : 13);

    var footprints = null;
    var buildingStats = null;

    if (useFootprints) {
      setStatus('Loading building footprints...', '#1d4ed8');
      footprints = getFootprints(aoiGeom, source, iso3, customAsset, minAreaM2);

      if (runZonal) {
        setStatus('Computing building-level summaries...', '#1d4ed8');
        buildingStats = summarizeByBuildings(result, footprints, buildingThreshold);
      }
    }

    drawResultLayers(aoiGeom, result, footprints, buildingStats);

    summaryLabel.setValue(
      'Summary: ' + mode.replace(' (1-month inference)', '').replace(' (single post-event image)', '') +
      ' | terrain flattening = ' + (useTerrain ? 'ON' : 'OFF') +
      ' | footprints = ' + (useFootprints ? 'ON' : 'OFF')
    );

    if (useFootprints && runZonal && buildingStats) {
      buildingStats.size().evaluate(function(total) {
        buildingsLabel.setValue('Buildings with valid mean T: ' + total);
      });

      buildingStats.filter(ee.Filter.eq('damaged_int', 1)).size().evaluate(function(dmg) {
        damagedLabel.setValue('Predicted damaged buildings: ' + dmg);
      });

      ee.Number(
        buildingStats.filter(ee.Filter.eq('damaged_int', 1)).size()
      ).divide(
        buildingStats.size()
      ).evaluate(function(share) {
        if (share !== null) {
          shareLabel.setValue('Predicted damage share: ' + (share * 100).toFixed(2) + '%');
        }
      });
    } else {
      buildingsLabel.setValue('Buildings: not computed');
      damagedLabel.setValue('Predicted damaged buildings: not computed');
      shareLabel.setValue('Predicted damage share: not computed');
    }

    setStatus('Done.', '#15803d');
  } catch (err) {
    setStatus('Error: ' + err.message, '#b91c1c');
  }
}


// ============================================================
// 13) BUTTON ACTIONS
// ============================================================
runButton.onClick(runAnalysis);

resetMapButton.onClick(function() {
  resetMapLayers();
  clearDrawings();
  resetSummary();
  map.centerObject(AOI_PRESETS['Full Gaza'], 10);
  setStatus('Map reset.', '#6b7280');
});


// ============================================================
// 14) INITIAL VIEW
// ============================================================
resetSummary();
setStatus('Ready. Choose parameters and click Run.', '#1d4ed8');
map.addLayer(ee.Image().paint(AOI_PRESETS['Full Gaza'], 1, 2), {palette: ['ffffff']}, 'Default AOI', true, 0.9);
