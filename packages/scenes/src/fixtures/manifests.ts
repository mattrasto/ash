import type { SceneBundle } from '../contracts.ts';

/** Immutable reviewed bundles; original Meadow is retained only as the generation style reference. */
export const fixtureManifests: readonly SceneBundle[] = [
  {
    "kind": "ash-scene",
    "version": 1,
    "rendererVersion": 1,
    "mapVersion": 1,
    "id": "meadow",
    "name": "Meadow",
    "width": 1024,
    "height": 1024,
    "assets": {
      "source": {
        "path": "assets/meadow.png",
        "sha256": "ae45b86ae8fc3c2f8a8d9c5eab0b3fc006e166965e45396ff5b1e29752aab1b0",
        "bytes": 1774877,
        "mediaType": "image/png",
        "width": 1024,
        "height": 1024
      },
      "mask": {
        "path": "assets/meadow-mask.png",
        "sha256": "5cfbafad6d12c30041363a67a8b72a228c66677b33068f56288847a828774009",
        "bytes": 13324,
        "mediaType": "image/png",
        "width": 1024,
        "height": 1024
      },
      "candidate": {
        "path": "assets/meadow-candidate.png",
        "sha256": "2d94177a3fb0e354bb4b388f3f92ac9017283f850a371857f70f72ca65880255",
        "bytes": 2087368,
        "mediaType": "image/png",
        "width": 1024,
        "height": 1024
      },
      "depth": {
        "path": "assets/meadow-depth.png",
        "sha256": "dafde4a88a6402d772287d7f1e91a489b6ad14ff76969191d4d17704719aa1e8",
        "bytes": 55941,
        "mediaType": "image/png",
        "width": 1024,
        "height": 1024
      },
      "surfaces": {
        "path": "assets/meadow-surfaces.png",
        "sha256": "e827e8d4b950562e0b8a8725270d159636fc16d408b5af94a0b49e07d0f69f8b",
        "bytes": 10356,
        "mediaType": "image/png",
        "width": 1024,
        "height": 1024
      }
    },
    "profile": {
      "version": 1,
      "daylight": 100,
      "clouds": true,
      "cloudStyle": "cumulus",
      "cloudSeed": 137,
      "amount": 40,
      "speed": 25,
      "cloudShadows": true,
      "shadowStrength": 8,
      "shadowSoftness": 70,
      "water": true,
      "waterStrength": 35,
      "waterSpeed": 25,
      "waterReflections": 35,
      "stars": true,
      "starBrightness": 120,
      "starGlow": true,
      "constellations": true,
      "meteors": true
    },
    "framing": {
      "mode": "contain",
      "orientation": 0
    },
    "provenance": {
      "sourceRepository": "design_experiments/fieldnotes",
      "sourceRevision": "abb4d21",
      "generation": {
        "tool": "User-provided Midjourney reference",
        "settings": "Not recorded"
      },
      "preparation": {
        "provider": "local-segformer+depth-anything",
        "model": "Xenova/segformer-b0-finetuned-ade-512-512",
        "recipe": "sky-horizon-v2+tone-lift-v1+surface-v3+depth-v1+shoreline-v1",
        "runtime": "transformers.js 4.3.1",
        "durationMs": 6574,
        "skyCoverage": 0.44535004858877103,
        "horizonCrops": 5,
        "labels": [
          "building",
          "sky",
          "tree",
          "grass",
          "mountain",
          "field",
          "hill"
        ],
        "maps": {
          "depth": {
            "model": "onnx-community/depth-anything-v2-small",
            "dtype": "fp32",
            "durationMs": 361,
            "low": 0.20762406289577484,
            "high": 7.4258832931518555,
            "percentiles": [
              1,
              99
            ],
            "near": "white",
            "units": "relative inverse depth",
            "bits": 8,
            "sky": 0
          },
          "surfaces": {
            "model": "Xenova/segformer-b2-finetuned-ade-512-512",
            "dtype": "fp32",
            "durationMs": 2241,
            "shorelineCrops": 0,
            "correctedPixels": 0,
            "labels": [
              "sky",
              "tree",
              "mountain",
              "field"
            ],
            "coverage": {
              "other": 0.001117706298828125,
              "terrain": 0.4327058792114258,
              "vegetation": 0.1208181381225586,
              "water": 0,
              "structure": 0,
              "sky": 0.4453582763671875
            },
            "encoding": "class-id-v1"
          }
        },
        "warnings": [
          "Baked cast-shadow edges remain. Shadow lift also brightens dark vegetation.",
          "Semantic boundaries are approximate; small structures and shaded slopes need review. Unclassified pixels are not safe surface assignments.",
          "Depth is relative, not metres; camera calibration and hidden geometry are not recovered."
        ],
        "cost": 0
      }
    },
    "verification": {
      "status": "verified",
      "method": "reviewed-fixture",
      "reviewedAt": "2026-10-22T00:00:00Z",
      "criteriaVersion": 1
    }
  },
  {
    "kind": "ash-scene",
    "version": 1,
    "rendererVersion": 1,
    "mapVersion": 1,
    "id": "meadow-panorama-v3",
    "name": "Meadow panorama",
    "width": 3966,
    "height": 1586,
    "assets": {
      "source": {
        "path": "assets/meadow-panorama-v1.png",
        "sha256": "5286d7426790a87087612a066baac396e0797f386f30092b355f5eb6544a2bfb",
        "bytes": 7414944,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "mask": {
        "path": "assets/meadow-panorama-v1-mask.png",
        "sha256": "6f729f048833a15299e2dfe5f3f951d350784c6337023d781c51fa60894226a9",
        "bytes": 61824,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "depth": {
        "path": "assets/meadow-panorama-v1-depth.png",
        "sha256": "e88b02dd5d842cdaa6e91158311411676bd7e5e8a5ea6ac5e324eedbcc7d4420",
        "bytes": 234940,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "surfaces": {
        "path": "assets/meadow-panorama-v1-surfaces.png",
        "sha256": "aea92a8845ae480ea4d1863ad73b76fed4efe0a2dcd88368f394f90afce8af44",
        "bytes": 33991,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "candidate": {
        "path": "assets/meadow-panorama-v1-candidate.png",
        "sha256": "f28db71c27e290b20f7b09c12562c4b572a18af8092e47235d113d1e7b329195",
        "bytes": 9612179,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      }
    },
    "profile": {
      "version": 1,
      "daylight": 90,
      "clouds": true,
      "cloudStyle": "cumulus",
      "cloudSeed": 137,
      "amount": 60,
      "speed": 100,
      "cloudShadows": true,
      "shadowStrength": 25,
      "shadowSoftness": 20,
      "water": false,
      "waterStrength": 140,
      "waterSpeed": 70,
      "waterReflections": 60,
      "stars": true,
      "starBrightness": 120,
      "starGlow": true,
      "constellations": true,
      "meteors": true
    },
    "framing": {
      "mode": "cover",
      "orientation": 0,
      "protectedRegion": {
        "x": 0.3,
        "y": 0.25,
        "width": 0.4,
        "height": 0.6
      }
    },
    "provenance": {
      "sourceRepository": "ash_experiments/scenes/comparison-2026-10-22",
      "sourceRevision": "24bef7e",
      "generation": {
        "path": "candidates/meadow-03.png",
        "sha256": "39576bff707799dc078770c08fb5ee18ace22d540a21c331ff7f19e82f2745bc",
        "width": 1983,
        "height": 793,
        "aspectRatio": 2.5006305170239598,
        "format": "PNG",
        "bytes": 2706006,
        "id": "meadow-03",
        "scene": "meadow",
        "round": "round2",
        "selectedForComparison": true,
        "selectedInRound": true,
        "tool": "Built-in image_gen.imagegen",
        "provider": null,
        "model": null,
        "seed": null,
        "usage": null,
        "cost": null,
        "unavailableMetadataReason": "The interactive tool exposes image and output path, not provider/model/seed/usage/cost metadata.",
        "transparentBackground": false,
        "promptKey": "meadow-03",
        "prompt": "Use case: stylized-concept.\nAsset type: original full-background landscape artwork for Ash, revised generation comparison.\nImage reference: The single supplied image is the ORIGINAL MIDJOURNEY MEADOW and the SOLE style reference. Study only its subdued color, broad rounded forms and coarse matte paint grain. Do not copy its composition, hill contours, tree placements or architecture. Do not use any previous generated Lakeside or Valley images as references.\nStyle: quietly illustrative 2D scenery with restrained storybook warmth, broad smooth softly modeled terrain, simple compact rounded foliage masses, very few large shapes and low fine-detail density. Subdued, slightly desaturated dusty sage, soft olive, pale yellow-green and muted leaf-green vegetation; pale powder-blue sky and muted distant blue-green terrain. Match the original Meadow's gentle low-contrast color relationships. Coarse, irregular matte paper/paint grain should integrate the broad color fields. Foliage reads as large softly rounded canopy masses, not thousands of tiny leaves or dots. Keep edges readable without crisp micro-detail. Do not increase saturation, contrast or sharpness relative to the supplied reference. No neon green, acid yellow, cyan-blue, hyper-detailed grass, repetitive tiny leaf speckles, glossy finish, photorealism or vector-clean gradients.\nLighting: even neutral midday ambient illumination, softly modeled volume and only very faint short contact shading. No obvious directional key light, long cast shadows, high-contrast foreground shadow bands, spotlight patches or baked sunset color. Later runtime lighting will supply the changing light.\nCanvas and framing: generate a genuinely panoramic approximately 2.5:1 image, preferably 2560 by 1024 pixels or a similar wide ratio at useful resolution. Full bleed artwork to every edge. The scene must fill a desktop background via aspect-preserving cover cropping, with no bars or inset picture. Keep the essential landscape identity inside the central 35% of image width, visible even after a centered crop to a 740 by 650 window; the wide outer wings provide expendable continuation of the landscape. The narrow central crop must read as a finished composition, while the full panorama remains balanced. Use layered scenery in the lower half and sufficient clear sky above. Do not put essential subjects at far edges.\nAvoid: text, UI, borders, framing devices, clouds, sun disc, stars, mist, heavy fog, monumental structures, surreal geometry, animals or people. Create original artwork only; no comparison layouts, masks, labels, annotations or crop guides.\nPrimary scene: an open, spacious, gently undulating DRY meadow. A shallow broad meadow bowl opens through the center; low distant hills sweep across the horizon. A small loose group of rounded trees sits left of center and two simple compact canopy groups recede toward the opposite ridge. A tiny understated gray stone gateway is optional on a central far ridge, much smaller than the trees. Relaxed pastoral openness with a quiet generous sky. Keep large smooth uninterrupted grassy areas and avoid a crowded forest or a mountain wall. Water presence: NONE; do not include any visible water.",
        "promptSha256": "833ec02b0edb7ddec6b4235291147293c71b7682968b6346026feb752dc7089f",
        "referenceIds": [
          "meadow"
        ],
        "referenceHashes": {
          "meadow": "ae45b86ae8fc3c2f8a8d9c5eab0b3fc006e166965e45396ff5b1e29752aab1b0"
        },
        "referenceRole": "Original Midjourney Meadow as sole style reference, not an edit target.",
        "templateVersion": "SCN-05-2026-10-22+meadow-only-subdued-panorama-v2",
        "attemptIdentity": "ash-living-scenes-2026-10-22/meadow-03",
        "requestedDimensions": [
          2560,
          1024
        ],
        "requestedAspectRatio": 2.5,
        "protectedCentralWidthFraction": 0.35,
        "repairOf": null,
        "outcome": "static-review-candidate",
        "originalToolOutputPath": "/Users/mattrasto/.codex/generated_images/01a16623-0ec7-7313-b0a1-95d72382cb70/exec-74ed2106-7fbf-4907-bdbf-92c7cb845d4b.png",
        "limits": [
          "Baked directional shading remains despite minimal-shadow prompt.",
          "Dimensions are tool-selected; source is smaller than requested.",
          "No preparation, animated rendering, motion or performance verification."
        ]
      },
      "preparation": {
        "recipe": "sky-horizon-v2+tone-lift-v1+surface-v3+depth-v1+shoreline-v1",
        "sourceHash": "39576bff707799dc078770c08fb5ee18ace22d540a21c331ff7f19e82f2745bc",
        "runtime": "transformers.js 4.3.1 / CPU FP32",
        "models": [
          {
            "role": "sky",
            "id": "Xenova/segformer-b0-finetuned-ade-512-512",
            "revision": "d3e5499fa8701ff0453ca940a8dfeae39b2f1504",
            "files": [
              {
                "path": "config.json",
                "sha256": "435799652b2b64c3e422dea20fed4c59651dae9f0e291fd885e9e067fee0ce2a",
                "bytes": 6957
              },
              {
                "path": "preprocessor_config.json",
                "sha256": "dbabd93c735c8a5c39ef207c6c4459bf2d261a5dcc55e1ba1c1b982e5947f518",
                "bytes": 373
              },
              {
                "path": "onnx/model.onnx",
                "sha256": "3e5c18a4be395f16646438d54c42377ddc202edfa33d5eced0c9506de75c44c2",
                "bytes": 15335446
              }
            ]
          },
          {
            "role": "surfaces",
            "id": "Xenova/segformer-b2-finetuned-ade-512-512",
            "revision": "df795789e70f4089c8658907679c6fd2367c89a5",
            "files": [
              {
                "path": "config.json",
                "sha256": "7cdad9cd7e4705d8316eedfa86508bae0687a1e59908bd1252ceec65b91076c2",
                "bytes": 6958
              },
              {
                "path": "preprocessor_config.json",
                "sha256": "dbabd93c735c8a5c39ef207c6c4459bf2d261a5dcc55e1ba1c1b982e5947f518",
                "bytes": 373
              },
              {
                "path": "onnx/model.onnx",
                "sha256": "819c15e6af8c4de3359c1de7ab0a17d0dde495df1d16f8908a7163f8038e0fa0",
                "bytes": 110445327
              }
            ]
          },
          {
            "role": "depth",
            "id": "onnx-community/depth-anything-v2-small",
            "revision": "4472b7362082ad9968fee890ca0f1e5aca36b93d",
            "files": [
              {
                "path": "config.json",
                "sha256": "3aee5b9bc4f711ee885c2526d871f0c8c6c8c4b26b8e04253d0167f6a83264f5",
                "bytes": 38
              },
              {
                "path": "preprocessor_config.json",
                "sha256": "03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6",
                "bytes": 461
              },
              {
                "path": "onnx/model.onnx",
                "sha256": "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c",
                "bytes": 99060839
              }
            ]
          }
        ],
        "durationMs": 15196,
        "diagnostics": {
          "horizonCrops": 12,
          "shorelineCrops": 0,
          "correctedPixels": 0,
          "labels": [
            "sky",
            "tree",
            "grass",
            "mountain",
            "field",
            "hill"
          ],
          "surfaceLabels": [
            "sky",
            "tree",
            "grass",
            "mountain",
            "field",
            "hill"
          ],
          "depthNormalization": {
            "low": 0.17131240665912628,
            "high": 8.047685623168945,
            "percentiles": [
              1,
              99
            ],
            "near": "white",
            "units": "relative inverse depth",
            "bits": 8,
            "sky": 0
          },
          "workerThreadId": 2
        },
        "warnings": [
          "Baked cast-shadow edges remain; shadow lift also brightens dark vegetation.",
          "Semantic boundaries are approximate; ambiguous water and foreground require verification.",
          "Depth is relative inverse depth, not metres or recovered camera geometry.",
          "Cover framing is proposed; verification must establish crop safety."
        ],
        "geometry": {
          "skyCoverage": 0.47263234414113164,
          "surfaceCoverage": {
            "other": 0.000023529127470001952,
            "terrain": 0.382586792274052,
            "vegetation": 0.14475755141909255,
            "water": 0,
            "structure": 0,
            "sky": 0.4726321271793854
          },
          "horizon": {
            "samples": [
              0.4073139974779319,
              0.403530895334174,
              0.4010088272383354,
              0.40226986128625475,
              0.4098360655737705,
              0.41866330390920553,
              0.4300126103404792,
              0.44388398486759145,
              0.4489281210592686,
              0.45775535939470363,
              0.46153846153846156,
              0.4691046658259773,
              0.47540983606557374,
              0.4791929382093317,
              0.4817150063051702,
              0.4552332912988651,
              0.44388398486759145,
              0.44388398486759145,
              0.45901639344262296,
              0.4880201765447667,
              0.48297604035308955,
              0.4791929382093317,
              0.4766708701134931,
              0.4728877679697352,
              0.4691046658259773,
              0.4691046658259773,
              0.47162673392181587,
              0.4766708701134931,
              0.48297604035308955,
              0.4905422446406053,
              0.5006305170239597,
              0.5081967213114754,
              0.5145018915510718,
              0.5170239596469105,
              0.5145018915510718,
              0.5119798234552333,
              0.5132408575031526,
              0.5157629255989912,
              0.519546027742749,
              0.519546027742749,
              0.519546027742749,
              0.5208070617906684,
              0.5233291298865069,
              0.5258511979823455,
              0.5283732660781841,
              0.5258511979823455,
              0.5182849936948297,
              0.5119798234552333,
              0.5094577553593947,
              0.5056746532156369,
              0.5006305170239597,
              0.4905422446406053,
              0.4817150063051702,
              0.4703656998738966,
              0.45901639344262296,
              0.4489281210592686,
              0.4401008827238335,
              0.4337957124842371,
              0.41740226986128626,
              0.4098360655737705,
              0.4110970996216898,
              0.4136191677175284,
              0.416141235813367,
              0.42118537200504413
            ],
            "median": 0.4766708701134931,
            "min": 0.4010088272383354,
            "max": 0.5283732660781841
          },
          "foregroundDepth": {
            "p10": 5,
            "p50": 80,
            "p90": 208
          },
          "palette": {
            "sky": [
              163,
              197,
              227
            ],
            "land": [
              133,
              159,
              125
            ]
          },
          "landLuminanceRange": [
            0.3995450980392157,
            0.7704431372549019
          ],
          "framing": {
            "mode": "cover",
            "orientation": 0
          }
        },
        "inferenceDimensions": [
          1983,
          793
        ],
        "outputDimensions": [
          3966,
          1586
        ],
        "resampling": {
          "artwork": "balanced RealESRGAN_x2plus 2x; tone-lift-v1 reapplied at output resolution",
          "mask": "linear 2x",
          "depth": "linear 2x",
          "surfaces": "nearest-neighbor 2x"
        },
        "upscale": {
          "id": "meadow-panorama",
          "path": "outputs/meadow-panorama-balanced2x.png",
          "sha256": "5286d7426790a87087612a066baac396e0797f386f30092b355f5eb6544a2bfb",
          "dimensions": [
            3966,
            1586
          ],
          "method": "Lanczos baseline + 50% high-frequency difference from RealESRGAN_x2plus; 8-output-pixel Gaussian low-frequency difference removed to retain broad palette.",
          "modelPath": "outputs/meadow-panorama-realesrgan2x.png",
          "baselinePath": "outputs/meadow-panorama-lanczos2x.png",
          "strength": 0.5,
          "lowFrequencyRadiusOutputPixels": 8,
          "meanChannelChangeVsBaseline": [
            0.0028089999686926603,
            -0.00056900002527982,
            -0.0028589998837560415
          ]
        }
      },
      "profile": {
        "sourceBundle": "meadow-panorama-v1",
        "defaultsVersion": "2026-10-23-shadow-v2"
      }
    },
    "verification": {
      "status": "verified",
      "method": "reviewed-fixture",
      "reviewedAt": "2026-10-23T05:02:00.940Z",
      "criteriaVersion": 1
    }
  },
  {
    "kind": "ash-scene",
    "version": 1,
    "rendererVersion": 1,
    "mapVersion": 1,
    "id": "lake-panorama-v3",
    "name": "Lakeside",
    "width": 3966,
    "height": 1586,
    "assets": {
      "source": {
        "path": "assets/lake-panorama-v1.png",
        "sha256": "5fd54ec74cf4d956caeea0eafcdc12bae2d5f642ebb513df1402eadebe0e37bc",
        "bytes": 7023623,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "mask": {
        "path": "assets/lake-panorama-v1-mask.png",
        "sha256": "4ce7a009ae2aa295e1776fcf56170f2580938067440a2ae2a6f4e023fa3c2cb6",
        "bytes": 74159,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "depth": {
        "path": "assets/lake-panorama-v1-depth.png",
        "sha256": "d9cf008d82a4016c5b65a09c866bc493df00512775cec3b7571748c1b67ce52a",
        "bytes": 240510,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "surfaces": {
        "path": "assets/lake-panorama-v1-surfaces.png",
        "sha256": "1481281b55267dc9828ee9d84edc7936afebb10e411f9bedb8247056c661d6c0",
        "bytes": 37512,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "candidate": {
        "path": "assets/lake-panorama-v1-candidate.png",
        "sha256": "0b841858ff687c5736e4b6861b2bbc9d38041f6d7e746d1b6f36ab8d301b4018",
        "bytes": 9517383,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      }
    },
    "profile": {
      "version": 1,
      "daylight": 90,
      "clouds": true,
      "cloudStyle": "cumulus",
      "cloudSeed": 137,
      "amount": 60,
      "speed": 100,
      "cloudShadows": true,
      "shadowStrength": 25,
      "shadowSoftness": 20,
      "water": true,
      "waterStrength": 140,
      "waterSpeed": 70,
      "waterReflections": 60,
      "stars": true,
      "starBrightness": 120,
      "starGlow": true,
      "constellations": true,
      "meteors": true
    },
    "framing": {
      "mode": "cover",
      "orientation": 0,
      "protectedRegion": {
        "x": 0.3,
        "y": 0.25,
        "width": 0.4,
        "height": 0.6
      }
    },
    "provenance": {
      "sourceRepository": "ash_experiments/scenes/comparison-2026-10-22",
      "sourceRevision": "24bef7e",
      "generation": {
        "path": "candidates/lake-02.png",
        "sha256": "7211214b361a191e0af3924c89d1e2d8eb45f2fccabba732246371e519e031b2",
        "width": 1983,
        "height": 793,
        "aspectRatio": 2.5006305170239598,
        "format": "PNG",
        "bytes": 2579448,
        "id": "lake-02",
        "scene": "lake",
        "round": "round2",
        "selectedForComparison": true,
        "selectedInRound": true,
        "tool": "Built-in image_gen.imagegen",
        "provider": null,
        "model": null,
        "seed": null,
        "usage": null,
        "cost": null,
        "unavailableMetadataReason": "The interactive tool exposes image and output path, not provider/model/seed/usage/cost metadata.",
        "transparentBackground": false,
        "promptKey": "lake-02",
        "prompt": "Use case: stylized-concept.\nAsset type: original full-background landscape artwork for Ash, revised generation comparison.\nImage reference: The single supplied image is the ORIGINAL MIDJOURNEY MEADOW and the SOLE style reference. Study only its subdued color, broad rounded forms and coarse matte paint grain. Do not copy its composition, hill contours, tree placements or architecture. Do not use any previous generated Lakeside or Valley images as references.\nStyle: quietly illustrative 2D scenery with restrained storybook warmth, broad smooth softly modeled terrain, simple compact rounded foliage masses, very few large shapes and low fine-detail density. Subdued, slightly desaturated dusty sage, soft olive, pale yellow-green and muted leaf-green vegetation; pale powder-blue sky and muted distant blue-green terrain. Match the original Meadow's gentle low-contrast color relationships. Coarse, irregular matte paper/paint grain should integrate the broad color fields. Foliage reads as large softly rounded canopy masses, not thousands of tiny leaves or dots. Keep edges readable without crisp micro-detail. Do not increase saturation, contrast or sharpness relative to the supplied reference. No neon green, acid yellow, cyan-blue, hyper-detailed grass, repetitive tiny leaf speckles, glossy finish, photorealism or vector-clean gradients.\nLighting: even neutral midday ambient illumination, softly modeled volume and only very faint short contact shading. No obvious directional key light, long cast shadows, high-contrast foreground shadow bands, spotlight patches or baked sunset color. Later runtime lighting will supply the changing light.\nCanvas and framing: generate a genuinely panoramic approximately 2.5:1 image, preferably 2560 by 1024 pixels or a similar wide ratio at useful resolution. Full bleed artwork to every edge. The scene must fill a desktop background via aspect-preserving cover cropping, with no bars or inset picture. Keep the essential landscape identity inside the central 35% of image width, visible even after a centered crop to a 740 by 650 window; the wide outer wings provide expendable continuation of the landscape. The narrow central crop must read as a finished composition, while the full panorama remains balanced. Use layered scenery in the lower half and sufficient clear sky above. Do not put essential subjects at far edges.\nAvoid: text, UI, borders, framing devices, clouds, sun disc, stars, mist, heavy fog, monumental structures, surreal geometry, animals or people. Create original artwork only; no comparison layouts, masks, labels, annotations or crop guides.\nPrimary scene: a still, sheltered pale-blue lake with a broad sweeping crescent shoreline. The central crop contains a readable expanse of water in the lower-middle, the opposite quiet grassy bank, and a low wooded headland, so it remains clearly a LAKESIDE scene when the outer wings disappear. Keep the horizon low and gentle. Place sparse small clusters of rounded trees along the banks, with only restrained large canopy masses near the outer wings. A few muted painted tree reflections appear in the calm lake; water is clearly separated from sky and land. Mood: airy stillness and open water. Distinct composition from the supplied Meadow: an open basin and sweeping shore, not the same hill-and-gateway layout. No buildings or gateway. No strong mirror contrast or detailed ripples.",
        "promptSha256": "4ae2f95a3dcf4a753c1790c23c4a8d08dc52185d65c1948ef8b1b7a62d4053b8",
        "referenceIds": [
          "meadow"
        ],
        "referenceHashes": {
          "meadow": "ae45b86ae8fc3c2f8a8d9c5eab0b3fc006e166965e45396ff5b1e29752aab1b0"
        },
        "referenceRole": "Original Midjourney Meadow as sole style reference, not an edit target.",
        "templateVersion": "SCN-05-2026-10-22+meadow-only-subdued-panorama-v2",
        "attemptIdentity": "ash-living-scenes-2026-10-22/lake-02",
        "requestedDimensions": [
          2560,
          1024
        ],
        "requestedAspectRatio": 2.5,
        "protectedCentralWidthFraction": 0.35,
        "repairOf": null,
        "outcome": "static-review-candidate",
        "originalToolOutputPath": "/Users/mattrasto/.codex/generated_images/01a16623-0ec7-7313-b0a1-95d72382cb70/exec-adc4025d-3081-4072-83b6-6e6b10467a9c.png",
        "limits": [
          "Baked directional shading remains despite minimal-shadow prompt.",
          "Dimensions are tool-selected; source is smaller than requested.",
          "No preparation, animated rendering, motion or performance verification."
        ]
      },
      "preparation": {
        "recipe": "sky-horizon-v2+tone-lift-v1+surface-v3+depth-v1+shoreline-v1",
        "sourceHash": "7211214b361a191e0af3924c89d1e2d8eb45f2fccabba732246371e519e031b2",
        "runtime": "transformers.js 4.3.1 / CPU FP32",
        "models": [
          {
            "role": "sky",
            "id": "Xenova/segformer-b0-finetuned-ade-512-512",
            "revision": "d3e5499fa8701ff0453ca940a8dfeae39b2f1504",
            "files": [
              {
                "path": "config.json",
                "sha256": "435799652b2b64c3e422dea20fed4c59651dae9f0e291fd885e9e067fee0ce2a",
                "bytes": 6957
              },
              {
                "path": "preprocessor_config.json",
                "sha256": "dbabd93c735c8a5c39ef207c6c4459bf2d261a5dcc55e1ba1c1b982e5947f518",
                "bytes": 373
              },
              {
                "path": "onnx/model.onnx",
                "sha256": "3e5c18a4be395f16646438d54c42377ddc202edfa33d5eced0c9506de75c44c2",
                "bytes": 15335446
              }
            ]
          },
          {
            "role": "surfaces",
            "id": "Xenova/segformer-b2-finetuned-ade-512-512",
            "revision": "df795789e70f4089c8658907679c6fd2367c89a5",
            "files": [
              {
                "path": "config.json",
                "sha256": "7cdad9cd7e4705d8316eedfa86508bae0687a1e59908bd1252ceec65b91076c2",
                "bytes": 6958
              },
              {
                "path": "preprocessor_config.json",
                "sha256": "dbabd93c735c8a5c39ef207c6c4459bf2d261a5dcc55e1ba1c1b982e5947f518",
                "bytes": 373
              },
              {
                "path": "onnx/model.onnx",
                "sha256": "819c15e6af8c4de3359c1de7ab0a17d0dde495df1d16f8908a7163f8038e0fa0",
                "bytes": 110445327
              }
            ]
          },
          {
            "role": "depth",
            "id": "onnx-community/depth-anything-v2-small",
            "revision": "4472b7362082ad9968fee890ca0f1e5aca36b93d",
            "files": [
              {
                "path": "config.json",
                "sha256": "3aee5b9bc4f711ee885c2526d871f0c8c6c8c4b26b8e04253d0167f6a83264f5",
                "bytes": 38
              },
              {
                "path": "preprocessor_config.json",
                "sha256": "03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6",
                "bytes": 461
              },
              {
                "path": "onnx/model.onnx",
                "sha256": "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c",
                "bytes": 99060839
              }
            ]
          }
        ],
        "durationMs": 27828,
        "diagnostics": {
          "horizonCrops": 12,
          "shorelineCrops": 12,
          "correctedPixels": 4224,
          "labels": [
            "building",
            "sky",
            "tree",
            "grass",
            "earth",
            "mountain",
            "water",
            "hill",
            "swimming pool",
            "lake"
          ],
          "surfaceLabels": [
            "sky",
            "tree",
            "grass",
            "mountain",
            "water",
            "sand",
            "river",
            "hill"
          ],
          "depthNormalization": {
            "low": 0.11788631975650787,
            "high": 6.97324800491333,
            "percentiles": [
              1,
              99
            ],
            "near": "white",
            "units": "relative inverse depth",
            "bits": 8,
            "sky": 0
          },
          "workerThreadId": 2
        },
        "warnings": [
          "Baked cast-shadow edges remain; shadow lift also brightens dark vegetation.",
          "Semantic boundaries are approximate; ambiguous water and foreground require verification.",
          "Depth is relative inverse depth, not metres or recovered camera geometry.",
          "Cover framing is proposed; verification must establish crop safety."
        ],
        "geometry": {
          "skyCoverage": 0.45691212883377563,
          "surfaceCoverage": {
            "other": 0.00008712136387541264,
            "terrain": 0.2136171327659634,
            "vegetation": 0.13424066736236573,
            "water": 0.19513977255600728,
            "structure": 0,
            "sky": 0.4569153059517882
          },
          "horizon": {
            "samples": [
              0.3644388398486759,
              0.3505674653215637,
              0.36065573770491804,
              0.3770491803278688,
              0.37831021437578816,
              0.3745271122320303,
              0.3858764186633039,
              0.39722572509457754,
              0.4073139974779319,
              0.41488020176544765,
              0.42370744010088274,
              0.4337957124842371,
              0.43253467843631777,
              0.4287515762925599,
              0.4224464060529634,
              0.41740226986128626,
              0.4085750315258512,
              0.4123581336696091,
              0.424968474148802,
              0.43253467843631777,
              0.4451450189155107,
              0.45775535939470363,
              0.46532156368221944,
              0.46279949558638084,
              0.45775535939470363,
              0.46153846153846156,
              0.4703656998738966,
              0.48045397225725095,
              0.4766708701134931,
              0.4691046658259773,
              0.4552332912988651,
              0.45901639344262296,
              0.467843631778058,
              0.4791929382093317,
              0.4943253467843632,
              0.49558638083228246,
              0.49810844892812106,
              0.49810844892812106,
              0.5044136191677175,
              0.510718789407314,
              0.5056746532156369,
              0.49936948297604034,
              0.4943253467843632,
              0.4905422446406053,
              0.48675914249684743,
              0.4766708701134931,
              0.4766708701134931,
              0.4842370744010088,
              0.4854981084489281,
              0.4842370744010088,
              0.4854981084489281,
              0.4943253467843632,
              0.5006305170239597,
              0.4968474148802018,
              0.489281210592686,
              0.48297604035308955,
              0.4791929382093317,
              0.4817150063051702,
              0.4854981084489281,
              0.48675914249684743,
              0.4842370744010088,
              0.47793190416141235,
              0.4665825977301387,
              0.467843631778058
            ],
            "median": 0.4703656998738966,
            "min": 0.3505674653215637,
            "max": 0.510718789407314
          },
          "foregroundDepth": {
            "p10": 6,
            "p50": 63,
            "p90": 206
          },
          "palette": {
            "sky": [
              169,
              202,
              229
            ],
            "land": [
              136,
              171,
              161
            ]
          },
          "landLuminanceRange": [
            0.46521882352941174,
            0.7476470588235293
          ],
          "framing": {
            "mode": "cover",
            "orientation": 0
          }
        },
        "inferenceDimensions": [
          1983,
          793
        ],
        "outputDimensions": [
          3966,
          1586
        ],
        "resampling": {
          "artwork": "balanced RealESRGAN_x2plus 2x; tone-lift-v1 reapplied at output resolution",
          "mask": "linear 2x",
          "depth": "linear 2x",
          "surfaces": "nearest-neighbor 2x"
        },
        "upscale": {
          "id": "lake-panorama",
          "path": "outputs/lake-panorama-balanced2x.png",
          "sha256": "5fd54ec74cf4d956caeea0eafcdc12bae2d5f642ebb513df1402eadebe0e37bc",
          "dimensions": [
            3966,
            1586
          ],
          "strength": 0.5,
          "lowFrequencyRadiusOutputPixels": 8,
          "method": "Lanczos + 50% neural-minus-Lanczos high-frequency difference; remove Gaussian radius-8 low-frequency difference.",
          "meanChannelChangeVsBaseline": [
            0.0003499999875202775,
            -0.004222000017762184,
            -0.0012240000069141388
          ]
        }
      },
      "profile": {
        "sourceBundle": "lake-panorama-v1",
        "defaultsVersion": "2026-10-23-shadow-v2"
      }
    },
    "verification": {
      "status": "verified",
      "method": "reviewed-fixture",
      "reviewedAt": "2026-10-23T17:23:44.978Z",
      "criteriaVersion": 1
    }
  },
  {
    "kind": "ash-scene",
    "version": 1,
    "rendererVersion": 1,
    "mapVersion": 1,
    "id": "valley-panorama-v3",
    "name": "Wooded valley",
    "width": 3966,
    "height": 1586,
    "assets": {
      "source": {
        "path": "assets/valley-panorama-v1.png",
        "sha256": "35d769384a0614fa77c5882f8e248d05aae7cab58dd1d92ae7877bcfbc3fe8e3",
        "bytes": 7845948,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "mask": {
        "path": "assets/valley-panorama-v1-mask.png",
        "sha256": "001b3169850c7474fb55d9c2a4a7b367cfac33f47d4c4467f7baad0627a27d07",
        "bytes": 87908,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "depth": {
        "path": "assets/valley-panorama-v1-depth.png",
        "sha256": "648afa98fb479b2249a3819d2db9655b2cebe2b88b50e267160bd0a8a12209c1",
        "bytes": 343540,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "surfaces": {
        "path": "assets/valley-panorama-v1-surfaces.png",
        "sha256": "2239be85271a0f54321427434f237f9dfc73c7bcddcaca904ecfddc2fddca8de",
        "bytes": 35693,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      },
      "candidate": {
        "path": "assets/valley-panorama-v1-candidate.png",
        "sha256": "39f095a3140c0ec86a96e074bb8ea2cce5d2ae48b00b2b6ebc2fddb2ddbbb2b1",
        "bytes": 10678445,
        "mediaType": "image/png",
        "width": 3966,
        "height": 1586
      }
    },
    "profile": {
      "version": 1,
      "daylight": 90,
      "clouds": true,
      "cloudStyle": "cumulus",
      "cloudSeed": 137,
      "amount": 60,
      "speed": 100,
      "cloudShadows": true,
      "shadowStrength": 25,
      "shadowSoftness": 20,
      "water": true,
      "waterStrength": 140,
      "waterSpeed": 70,
      "waterReflections": 60,
      "stars": true,
      "starBrightness": 120,
      "starGlow": true,
      "constellations": true,
      "meteors": true
    },
    "framing": {
      "mode": "cover",
      "orientation": 0,
      "protectedRegion": {
        "x": 0.3,
        "y": 0.25,
        "width": 0.4,
        "height": 0.6
      }
    },
    "provenance": {
      "sourceRepository": "ash_experiments/scenes/comparison-2026-10-22",
      "sourceRevision": "24bef7e",
      "generation": {
        "path": "candidates/valley-02.png",
        "sha256": "7174bb938f27ee304fc61160af1d0b425f56e4108f718607c24eda443c73e931",
        "width": 1983,
        "height": 793,
        "aspectRatio": 2.5006305170239598,
        "format": "PNG",
        "bytes": 2750680,
        "id": "valley-02",
        "scene": "valley",
        "round": "round2",
        "selectedForComparison": true,
        "selectedInRound": true,
        "tool": "Built-in image_gen.imagegen",
        "provider": null,
        "model": null,
        "seed": null,
        "usage": null,
        "cost": null,
        "unavailableMetadataReason": "The interactive tool exposes image and output path, not provider/model/seed/usage/cost metadata.",
        "transparentBackground": false,
        "promptKey": "valley-02",
        "prompt": "Use case: stylized-concept.\nAsset type: original full-background landscape artwork for Ash, revised generation comparison.\nImage reference: The single supplied image is the ORIGINAL MIDJOURNEY MEADOW and the SOLE style reference. Study only its subdued color, broad rounded forms and coarse matte paint grain. Do not copy its composition, hill contours, tree placements or architecture. Do not use any previous generated Lakeside or Valley images as references.\nStyle: quietly illustrative 2D scenery with restrained storybook warmth, broad smooth softly modeled terrain, simple compact rounded foliage masses, very few large shapes and low fine-detail density. Subdued, slightly desaturated dusty sage, soft olive, pale yellow-green and muted leaf-green vegetation; pale powder-blue sky and muted distant blue-green terrain. Match the original Meadow's gentle low-contrast color relationships. Coarse, irregular matte paper/paint grain should integrate the broad color fields. Foliage reads as large softly rounded canopy masses, not thousands of tiny leaves or dots. Keep edges readable without crisp micro-detail. Do not increase saturation, contrast or sharpness relative to the supplied reference. No neon green, acid yellow, cyan-blue, hyper-detailed grass, repetitive tiny leaf speckles, glossy finish, photorealism or vector-clean gradients.\nLighting: even neutral midday ambient illumination, softly modeled volume and only very faint short contact shading. No obvious directional key light, long cast shadows, high-contrast foreground shadow bands, spotlight patches or baked sunset color. Later runtime lighting will supply the changing light.\nCanvas and framing: generate a genuinely panoramic approximately 2.5:1 image, preferably 2560 by 1024 pixels or a similar wide ratio at useful resolution. Full bleed artwork to every edge. The scene must fill a desktop background via aspect-preserving cover cropping, with no bars or inset picture. Keep the essential landscape identity inside the central 35% of image width, visible even after a centered crop to a 740 by 650 window; the wide outer wings provide expendable continuation of the landscape. The narrow central crop must read as a finished composition, while the full panorama remains balanced. Use layered scenery in the lower half and sufficient clear sky above. Do not put essential subjects at far edges.\nAvoid: text, UI, borders, framing devices, clouds, sun disc, stars, mist, heavy fog, monumental structures, surreal geometry, animals or people. Create original artwork only; no comparison layouts, masks, labels, annotations or crop guides.\nPrimary scene: a sheltered wooded valley with broad rounded foliage masses stepping down from both sides toward a central luminous grassy clearing. The central crop shows a layered succession of canopy groups and an open green passage leading into low distant terrain, so it remains clearly a WOODED VALLEY when cropped. The surrounding trees have simple solid compact crowns with a few large irregular separations, not an individually drawn leafy forest. Foreground canopy groups are visibly separate from middle-distance woods and far hills. Mood: enclosed, restful and slightly more intimate than the open Meadow or Lake, without losing clear sky. Asymmetric low-canopy framing, no overhanging branches across the top edge, no huge mountain wall. Water presence: NONE. No buildings, gateway or visible path.",
        "promptSha256": "73ace4bddd661f2dfaea7aeac8d866ec39f5553703e8ec26a219e48de1ec8386",
        "referenceIds": [
          "meadow"
        ],
        "referenceHashes": {
          "meadow": "ae45b86ae8fc3c2f8a8d9c5eab0b3fc006e166965e45396ff5b1e29752aab1b0"
        },
        "referenceRole": "Original Midjourney Meadow as sole style reference, not an edit target.",
        "templateVersion": "SCN-05-2026-10-22+meadow-only-subdued-panorama-v2",
        "attemptIdentity": "ash-living-scenes-2026-10-22/valley-02",
        "requestedDimensions": [
          2560,
          1024
        ],
        "requestedAspectRatio": 2.5,
        "protectedCentralWidthFraction": 0.35,
        "repairOf": null,
        "outcome": "static-review-candidate",
        "originalToolOutputPath": "/Users/mattrasto/.codex/generated_images/01a16623-0ec7-7313-b0a1-95d72382cb70/exec-33bdcb69-3fe2-4307-94e8-ed5c7bd429d1.png",
        "limits": [
          "Baked directional shading remains despite minimal-shadow prompt.",
          "Dimensions are tool-selected; source is smaller than requested.",
          "No preparation, animated rendering, motion or performance verification."
        ]
      },
      "preparation": {
        "recipe": "sky-horizon-v2+tone-lift-v1+surface-v3+depth-v1+shoreline-v1",
        "sourceHash": "7174bb938f27ee304fc61160af1d0b425f56e4108f718607c24eda443c73e931",
        "runtime": "transformers.js 4.3.1 / CPU FP32",
        "models": [
          {
            "role": "sky",
            "id": "Xenova/segformer-b0-finetuned-ade-512-512",
            "revision": "d3e5499fa8701ff0453ca940a8dfeae39b2f1504",
            "files": [
              {
                "path": "config.json",
                "sha256": "435799652b2b64c3e422dea20fed4c59651dae9f0e291fd885e9e067fee0ce2a",
                "bytes": 6957
              },
              {
                "path": "preprocessor_config.json",
                "sha256": "dbabd93c735c8a5c39ef207c6c4459bf2d261a5dcc55e1ba1c1b982e5947f518",
                "bytes": 373
              },
              {
                "path": "onnx/model.onnx",
                "sha256": "3e5c18a4be395f16646438d54c42377ddc202edfa33d5eced0c9506de75c44c2",
                "bytes": 15335446
              }
            ]
          },
          {
            "role": "surfaces",
            "id": "Xenova/segformer-b2-finetuned-ade-512-512",
            "revision": "df795789e70f4089c8658907679c6fd2367c89a5",
            "files": [
              {
                "path": "config.json",
                "sha256": "7cdad9cd7e4705d8316eedfa86508bae0687a1e59908bd1252ceec65b91076c2",
                "bytes": 6958
              },
              {
                "path": "preprocessor_config.json",
                "sha256": "dbabd93c735c8a5c39ef207c6c4459bf2d261a5dcc55e1ba1c1b982e5947f518",
                "bytes": 373
              },
              {
                "path": "onnx/model.onnx",
                "sha256": "819c15e6af8c4de3359c1de7ab0a17d0dde495df1d16f8908a7163f8038e0fa0",
                "bytes": 110445327
              }
            ]
          },
          {
            "role": "depth",
            "id": "onnx-community/depth-anything-v2-small",
            "revision": "4472b7362082ad9968fee890ca0f1e5aca36b93d",
            "files": [
              {
                "path": "config.json",
                "sha256": "3aee5b9bc4f711ee885c2526d871f0c8c6c8c4b26b8e04253d0167f6a83264f5",
                "bytes": 38
              },
              {
                "path": "preprocessor_config.json",
                "sha256": "03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6",
                "bytes": 461
              },
              {
                "path": "onnx/model.onnx",
                "sha256": "afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c",
                "bytes": 99060839
              }
            ]
          }
        ],
        "durationMs": 13683,
        "diagnostics": {
          "horizonCrops": 12,
          "shorelineCrops": 0,
          "correctedPixels": 0,
          "labels": [
            "sky",
            "tree",
            "grass",
            "mountain",
            "field",
            "hill"
          ],
          "surfaceLabels": [
            "sky",
            "tree",
            "mountain",
            "field"
          ],
          "depthNormalization": {
            "low": 0.13388708233833313,
            "high": 7.1180739402771,
            "percentiles": [
              1,
              99
            ],
            "near": "white",
            "units": "relative inverse depth",
            "bits": 8,
            "sky": 0
          },
          "workerThreadId": 3
        },
        "warnings": [
          "Baked cast-shadow edges remain; shadow lift also brightens dark vegetation.",
          "Semantic boundaries are approximate; ambiguous water and foreground require verification.",
          "Depth is relative inverse depth, not metres or recovered camera geometry.",
          "Cover framing is proposed; verification must establish crop safety."
        ],
        "geometry": {
          "skyCoverage": 0.4092051283422811,
          "surfaceCoverage": {
            "other": 0.00016470389229001367,
            "terrain": 0.23575676987050712,
            "vegetation": 0.3548853781734911,
            "water": 0,
            "structure": 0,
            "sky": 0.40919314806371176
          },
          "horizon": {
            "samples": [
              0.31021437578814626,
              0.29129886506935687,
              0.287515762925599,
              0.30390920554854983,
              0.3026481715006305,
              0.30390920554854983,
              0.31778058007566207,
              0.33039092055485497,
              0.3455233291298865,
              0.38083228247162676,
              0.37831021437578816,
              0.403530895334174,
              0.40226986128625475,
              0.4110970996216898,
              0.4047919293820933,
              0.40226986128625475,
              0.41866330390920553,
              0.43253467843631777,
              0.43505674653215637,
              0.43883984867591425,
              0.4401008827238335,
              0.43883984867591425,
              0.4451450189155107,
              0.4527112232030265,
              0.4665825977301387,
              0.46153846153846156,
              0.4791929382093317,
              0.4880201765447667,
              0.4930643127364439,
              0.4968474148802018,
              0.489281210592686,
              0.4880201765447667,
              0.48675914249684743,
              0.4817150063051702,
              0.4728877679697352,
              0.47162673392181587,
              0.4728877679697352,
              0.4728877679697352,
              0.47540983606557374,
              0.4665825977301387,
              0.46279949558638084,
              0.46153846153846156,
              0.46153846153846156,
              0.4640605296343001,
              0.467843631778058,
              0.4728877679697352,
              0.45649432534678436,
              0.44136191677175285,
              0.4312736443883985,
              0.43505674653215637,
              0.41488020176544765,
              0.4085750315258512,
              0.39974779319041615,
              0.3883984867591425,
              0.3669609079445145,
              0.3530895334174023,
              0.33669609079445145,
              0.3266078184110971,
              0.31021437578814626,
              0.29760403530895335,
              0.29508196721311475,
              0.296343001261034,
              0.296343001261034,
              0.3026481715006305
            ],
            "median": 0.43253467843631777,
            "min": 0.287515762925599,
            "max": 0.4968474148802018
          },
          "foregroundDepth": {
            "p10": 11,
            "p50": 83,
            "p90": 189
          },
          "palette": {
            "sky": [
              161,
              197,
              221
            ],
            "land": [
              112,
              150,
              115
            ]
          },
          "landLuminanceRange": [
            0.4008109803921568,
            0.7262345098039215
          ],
          "framing": {
            "mode": "cover",
            "orientation": 0
          }
        },
        "inferenceDimensions": [
          1983,
          793
        ],
        "outputDimensions": [
          3966,
          1586
        ],
        "resampling": {
          "artwork": "balanced RealESRGAN_x2plus 2x; tone-lift-v1 reapplied at output resolution",
          "mask": "linear 2x",
          "depth": "linear 2x",
          "surfaces": "nearest-neighbor 2x"
        },
        "upscale": {
          "id": "valley-panorama",
          "path": "outputs/valley-panorama-balanced2x.png",
          "sha256": "35d769384a0614fa77c5882f8e248d05aae7cab58dd1d92ae7877bcfbc3fe8e3",
          "dimensions": [
            3966,
            1586
          ],
          "strength": 0.5,
          "lowFrequencyRadiusOutputPixels": 8,
          "method": "Lanczos + 50% neural-minus-Lanczos high-frequency difference; remove Gaussian radius-8 low-frequency difference.",
          "meanChannelChangeVsBaseline": [
            0.0038920000661164522,
            -0.0009469999931752682,
            -0.001888000057078898
          ]
        }
      },
      "profile": {
        "sourceBundle": "valley-panorama-v1",
        "defaultsVersion": "2026-10-23-shadow-v2"
      }
    },
    "verification": {
      "status": "verified",
      "method": "reviewed-fixture",
      "reviewedAt": "2026-10-23T17:23:46.348Z",
      "criteriaVersion": 1
    }
  }
];
