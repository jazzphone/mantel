# Weather

Open **HK Settings → Pages → Weather** to choose the weather service, forecasts,
optional sensors, radar and presentation. The header, Weather page, weather
sheet and Weather Alerts chip share the same sources; a separate weather
integration is not required for each card.

The page shows current conditions over the existing live sky, an hourly
forecast with HK's standard Temperature / Rain / Wind tabs, daily temperature
ranges on one scale, and detail tiles. Tap a day or tile for its weather sheet;
hold and drag the sheet's graph, or use its arrow keys, to inspect a reading.
An active alert opens its details. Ended alerts are hidden.

The current temperature has the screensaver's weather glyph behind it, placed
the way the screensaver's weather screen places it (large, up and to the left,
the number over its lower right), with the same condition and day/night
variants and gentle layer animations. It
stays still with Reduce Motion or Sky Animations off, and pauses while the
header is offscreen, the tab is hidden or HK is asleep. This reuses the
installed glyphs and existing weather source; no extra card or service is needed.

## Forecast & Details

Choose Current Conditions, Hourly Forecast, Daily Forecast and Weather Alerts
individually. Hours can be 6, 12 (default) or 24; days can be 5, 8 (default) or
10. Only the forecast supplied by the service is shown. Temperature is the
initial hourly view unless you choose Rain or Wind; a missing metric is
disabled and the page uses one the forecast supplies.

Reorder, add or remove Wind, Sunrise, UV Index, Humidity, Moon and Pressure
under **Details**. A chosen tile whose reading is missing explains that it is
unavailable. Values and units come from the configured sources. Reset Forecast
& Details restores this group, including loading animation, without changing
the weather service, sensors or radar.

## Optional Readings

Each empty sensor setting falls back to the weather service where possible.
Feels Like, Humidity, Wind Speed, Wind Gust, UV Index and Outside Temperature
can use sensors. Daily Forecast and Hourly Forecast can use sensors with a
`forecast` attribute; otherwise cards and the weather sheet share one Home
Assistant forecast subscription per weather entity and forecast kind.

Weather Alerts accepts the NWS Alerts integration's count and alert attributes.
No alerts sensor means no alert card or chip. Sunrise and sunset use `sun.sun`;
the moon follows the existing sky moon source.

## Radar Map

HK draws its own radar over OpenStreetMap; **Weather Radar Card from HACS is no
longer required**. Enable **Show Radar**, choose a provider and use Home
Assistant's home location or an existing zone. No account or API key is needed
for these built-in providers. Automatic chooses NOAA for a US home and
RainViewer elsewhere. A zone with no known country requires an explicit
provider; HK does not geocode it.

The page radar is a centered regional view, initially zoom 5, with your
location marked and history playing on entry. Its heading sits on a compact plate so map labels do not show through. A
read-only timeline shows the actual start/end times and the frame currently
displayed. The only action is Expand; pan, zoom, recenter and playback controls
are in the expanded map. Closing it
restores the centered page view. Escape closes the expanded map too.

**Advanced** changes initial zoom (4–10), location marker, movement in the
expanded map, radar opacity (20–100%), history (30 / 60 / 120 minutes), speed
and Play on Open. Playback is available in Flat. With Reduce Motion, use the
expanded map's play button. Hidden/offscreen/asleep maps stop playback and
refreshes; waking does not resume playback by itself.

**Check Radar Connection** requests the selected provider's metadata and one
small radar image, once, and reports coverage, frame count and latest time.
It stops when you leave the page or change radar settings. Internet access is
required: the providers receive the displayed map region and your browser's
network address. No map or radar service is requested while radar is disabled.

- **NOAA/NWS:** public US radar, including regional mosaics where available.
  Frames use the service's actual timestamps, with transparent images aligned
  in Web Mercator. See [NOAA terms](https://www.weather.gov/disclaimer).
- **RainViewer:** observed radar history, with coverage varying by country.
  Its imagery stops at zoom 7; closer map zoom enlarges that imagery rather
  than adding detail. Free personal use is subject to its
  [API terms](https://www.rainviewer.com/api.html); no service guarantee is implied.
- **OpenStreetMap:** credited on every map. Public tile hosting has
  [usage limits](https://operations.osmfoundation.org/policies/tiles/), not
  unlimited capacity. HK uses browser HTTP caching and requests visible tiles
  with a small pan margin; it does not offer offline downloads.

A failed provider does not silently switch to a different one. A connection
failure retains older imagery with its actual time and an offline label; an
empty response clears it. Forecasts continue independently of radar.

Upgrading an existing installation with Weather Radar Card enables native
radar and carries over supported options. New installations start with radar
off. Old `weather.radar` options remain untouched and are shown read-only
under **Weather Radar Card Options**. Unsupported old options do not change
the native map. A Weather Radar Card placed on your own dashboard is unaffected.

## Presentation

**Animate Page Loading** builds each card's contents when you arrive at the
page, the way the Energy page draws its graphs: the hours rise one after
another, each day's range grows from its low, the wind needle turns, the
sunrise arc draws and the tiles' bars and marks fill in. The cards themselves
stay in place, and a card further down builds when you scroll to it. It runs
once per visit, never on a weather update, and in Flat too. Reduce Motion or
turning Animate Page Loading off shows everything at once. Sky / Background uses HK's
existing per-page background settings; sky motion is separate from card
entrance motion and radar playback.
