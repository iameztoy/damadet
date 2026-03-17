# PWTT Damage Detection App (v.0.3)

## Overview

The **PWTT Damage Detection App** is a Google Earth Engine application for detecting and visualizing potential structural damage in built-up areas using **Sentinel-1 SAR imagery**. The app is designed for rapid exploratory analysis in conflict-affected or disaster-affected urban environments, with **Gaza** included as the default example area.

The objective of the app is to help users:

- identify areas showing statistically significant radar backscatter change,
- explore those changes interactively in Google Earth Engine,
- optionally summarize results at the **building-footprint level**, and
- test how parameter choices affect the final outputs.

## Methodology

The app is based on the **Pixel-Wise T-Test (PWTT)** workflow.

In brief, the method:

1. builds a **pre-event reference period** from Sentinel-1 imagery,
2. compares it against a **post-event inference period**,
3. computes a change statistic separately by **orbit** and **polarization** (`VV` and `VH`),
4. keeps the strongest detected change response,
5. applies multi-scale smoothing, and
6. masks outputs to **built-up areas** using Dynamic World.

The app also includes optional extensions such as:

- **PWZS mode** for single-image post-event comparison,
- **terrain flattening** for more rugged terrain,
- **building-level summarization** based on the mean T-value within each footprint.

## User parameters (v3)

The user can configure the following parameters:

### Area of interest
- **AOI preset**: Full Gaza or North Gaza test area
- **Draw AOI**: user-defined polygon or rectangle

### Time settings
- **War start date**
- **Inference start date**
- **Pre-event months**
- **Post-event months**

### Processing mode
- **PWTT**: compares a pre-event baseline against a post-event time window
- **PWZS**: compares a pre-event baseline against the first available post-event image

### Thresholds
- **Built-up mask threshold**
- **Raster damage threshold**
- **Building mean-T damage threshold**
- **Minimum building area**

### Optional preprocessing
- **Enable terrain flattening**
- **Terrain flattening model**: `DIRECT` or `VOLUME`
- **Layover/shadow buffer**

### Optional building workflow
- **Enable building footprints**
- **Compute building-level mean T**
- **Footprint source**:
  - `VIDA_COMBINED`
  - `MSBUILDINGS_AUTO`
  - `GHS_OBAT_AUTO`
  - `OBM`
  - `GOOGLE_OPEN_BUILDINGS`
  - `CUSTOM`
- **Country ISO3**
- **Custom asset path**

### Visualization
The user can show or hide:
- **T-statistic**
- **max_change**
- **binary damage**
- **built-up mask**
- **footprint outlines**

## How to use

1. Open the script in the **Google Earth Engine Code Editor**.
2. Run the script to launch the app interface.
3. Select an **AOI** or draw your own.
4. Set the **dates** and choose the analysis mode (`PWTT` or `PWZS`).
5. Adjust thresholds if needed.
6. For a quick first test, keep **terrain flattening** and **building footprints** disabled.
7. Click **Run analysis**.
8. Review the map layers, legend, and summary panel.
9. Optionally enable **building footprints** and **building-level mean T** for footprint-based outputs.

## Recommended first run

For a stable first run, use:

- **AOI**: Full Gaza
- **Mode**: PWTT
- **Terrain flattening**: OFF
- **Building footprints**: OFF

After confirming the raster output works correctly, enable the optional building workflow.

## Outputs

The app can display:

- **T-statistic map**
- **max_change map**
- **binary damage layer**
- **built-up mask**
- **building footprints**
- **predicted damaged / undamaged buildings**
- **building counts and predicted damage share**

## Notes and limitations

- This app is intended for **screening and exploratory analysis**, not as a final validated damage inventory.
- Results depend on the selected dates, AOI, thresholds, preprocessing choices, and footprint source.
- Some community footprint datasets may require small adjustments to asset paths depending on the user’s Earth Engine environment.
- The `CUSTOM` footprint option is included as a reliable fallback.
- Terrain flattening is optional and is generally more relevant in **rugged terrain** than in flat urban settings.

## Version 3 highlights

- Interactive Google Earth Engine app interface
- English legend and status panel
- AOI presets and draw mode
- PWTT and PWZS support
- Optional terrain flattening
- Optional building-level summarization
- Multiple footprint-source options
- Layer visibility controls

## References

Based on:

- **Open access battle damage detection via Pixel-Wise T-Test on Sentinel-1 imagery**  
  https://www.sciencedirect.com/science/article/pii/S0034425725004298

Python version available at:

- https://github.com/oballinger/PWTT/blob/main/code/pwtt.py
