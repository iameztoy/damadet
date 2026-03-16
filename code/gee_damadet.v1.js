/**** 
 * PWTT translated to Google Earth Engine JavaScript
 * Public, runnable example for Gaza
 * Based on the Python workflow from oballinger/PWTT
 ****/

// ===============================
// 0) User settings
// ===============================
var aoi = ee.Geometry.Rectangle([34.21, 31.21, 34.57, 31.60], null, false); //GAZA
// Faster small test in North Gaza:
// var aoi = ee.Geometry.Rectangle([34.38, 31.48, 34.50, 31.58], null, false);

var warStart = ee.Date('2023-10-10');
var inferenceStart = ee.Date('2024-07-01');

var preIntervalMonths = 12;   // reference window before warStart
var postIntervalMonths = 1;   // inference window after inferenceStart
var builtThreshold = 0.10;    // Dynamic World built mask
var damageThreshold = 3.0;    // binary threshold used in the original code

Map.setOptions('SATELLITE');
Map.centerObject(aoi, 10);

// ===============================
// 1) Lee filter
// ===============================
function leeFilter(image) {
  var kernelSize = 2;
  var bandNames = ee.List(image.bandNames()).remove('angle');

  // Sentinel-1 GRD is assumed multilooked ~5 times in range in the original code
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

// ===============================
// 2) Helpers
// ===============================
function toNaturalLog(img) {
  // Keep the original properties for later aggregation
  var out = img.select(['VV', 'VH']).log();
  return out.copyProperties(img, img.propertyNames());
}

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

function ttest(s1, inferenceStartDate, warStartDate, preMonths, postMonths) {
  var pre = s1.filterDate(
    warStartDate.advance(ee.Number(preMonths).multiply(-1), 'month'),
    warStartDate
  );

  var post = s1.filterDate(
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

// ===============================
// 3) Main PWTT function
// ===============================
function buildPWTT(aoiGeom, inferenceStartDate, warStartDate, preMonths, postMonths) {
  var s1Base = ee.ImageCollection('COPERNICUS/S1_GRD_FLOAT')
    .filterBounds(aoiGeom)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));

  var s1Reference = s1Base.filterDate(
    warStartDate.advance(-preMonths, 'month'),
    warStartDate
  );

  var s1Inference = s1Base.filterDate(
    inferenceStartDate,
    inferenceStartDate.advance(postMonths, 'month')
  );

  print('Reference-period image count:', s1Reference.size());
  print('Inference-period image count:', s1Inference.size());

  var orbitList = ee.List(
    s1Inference.aggregate_array('relativeOrbitNumber_start')
  ).distinct().sort();

  print('Relative orbits used:', orbitList);

  var orbitImages = orbitList.map(function(orbit) {
    orbit = ee.Number(orbit);

    var s1Orbit = s1Base
      .filter(ee.Filter.eq('relativeOrbitNumber_start', orbit))
      .map(leeFilter)
      .map(toNaturalLog);

    var tImg = ttest(
      s1Orbit,
      inferenceStartDate,
      warStartDate,
      preMonths,
      postMonths
    );

    return tImg.set('relativeOrbitNumber_start', orbit);
  });

  var orbitCollection = ee.ImageCollection.fromImages(orbitImages);
  var orbitMax = orbitCollection.max(); // max across orbits, still VV/VH bands

  // Final orbit/polarization collapse: max(VV, VH)
  var maxChange = orbitMax.select('VV')
    .max(orbitMax.select('VH'))
    .rename('max_change');

  // Urban/built mask
  var built = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(aoiGeom)
    .filterDate(warStartDate.advance(-preMonths, 'month'), warStartDate)
    .select('built')
    .mean()
    .rename('built');

  // Small despeckling / stabilization step from the original code
  var base = maxChange
    .focalMedian(10, 'circle', 'meters')
    .clip(aoiGeom)
    .updateMask(built.gt(builtThreshold))
    .rename('max_change');

  // Multi-scale smoothing
  var k50 = base.convolve(ee.Kernel.circle(50, 'meters', true)).rename('k50');
  var k100 = base.convolve(ee.Kernel.circle(100, 'meters', true)).rename('k100');
  var k150 = base.convolve(ee.Kernel.circle(150, 'meters', true)).rename('k150');

  var damage = base.gt(damageThreshold).rename('damage');

  var tStatistic = base
    .add(k50)
    .add(k100)
    .add(k150)
    .divide(4)
    .rename('T_statistic');

  return ee.Image.cat([
    tStatistic,
    damage.toFloat(),
    base,
    built,
    k50,
    k100,
    k150
  ]).toFloat().clip(aoiGeom);
}

// ===============================
// 4) Run
// ===============================
var result = buildPWTT(
  aoi,
  inferenceStart,
  warStart,
  preIntervalMonths,
  postIntervalMonths
);

print('PWTT result image:', result);

// ===============================
// 5) Visualization
// ===============================
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

Map.addLayer(ee.Image().paint(aoi, 1, 2), {palette: ['white']}, 'AOI', true, 0.8);
Map.addLayer(result.select('built'), builtVis, 'Dynamic World built mean', false);
Map.addLayer(result.select('max_change'), tVis, 'PWTT max_change', false);
Map.addLayer(result.select('T_statistic'), tVis, 'PWTT T_statistic', true);
Map.addLayer(result.select('damage').selfMask(), {palette: ['ff0000']}, 'Damage > 3', true);

// ===============================
// 6) Optional export
// ===============================
// Export.image.toDrive({
//   image: result.select('T_statistic'),
//   description: 'PWTT_Gaza_TStatistic_2024_07',
//   folder: 'PWTT_Export',
//   region: aoi,
//   scale: 10,
//   maxPixels: 1e13
// });

// Export.image.toDrive({
//   image: result.select('damage'),
//   description: 'PWTT_Gaza_DamageBinary_2024_07',
//   folder: 'PWTT_Export',
//   region: aoi,
//   scale: 10,
//   maxPixels: 1e13
// });
