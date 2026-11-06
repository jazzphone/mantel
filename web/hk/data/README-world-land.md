# Globe geography

`world-land.json` contains Natural Earth's 1:110m land polygons. The source is
`geojson/ne_110m_land.geojson` at revision
`ca96624a56bd078437bca8184e78163e5039ad19` of
https://github.com/nvkelso/natural-earth-vector.

Natural Earth data is public domain:
https://www.naturalearthdata.com/about/terms-of-use/.

Generation keeps all polygon rings, drops feature properties, combines them into
a GeoJSON MultiPolygon, and rounds longitude/latitude to three decimal places.
The source SHA-256 is `9e0729ee253ca7d7a5c4ae9395fb1902264c5377c52e224d13dd85010e2835d9`.
No geometry simplification is applied. The data is bundled with Mantel and never
requested from another service by a screen.

The spherical projection in `hk-globe-map.js` uses a bundled, tree-shaken copy of
`d3-geo@3.1.1`, with `d3-array@3.2.4` and `internmap@2.0.3`. Licenses are beside
`vendor/d3-geo.js`. To rebuild it, install those pinned packages into a temporary
directory, put `export {geoOrthographic,geoPath,geoArea} from 'd3-geo';` in an
entry file there, and run the repository's pinned esbuild against that file with
`--bundle --format=esm --minify --legal-comments=none`. Keep the license files.

The generated bundle and original licenses are checksum-pinned in `vendor/vendor.json`. The authored globe adapter remains under the project’s JavaScript type checks; pinned third-party code is checked for integrity and licenses instead of being added to the authored-code exception list.
