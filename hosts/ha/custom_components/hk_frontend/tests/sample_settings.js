// A SAMPLE house's dashboard settings, the shape the integration hands a
// screen (settings.py as_client). Load after the window/document stubs:
//
//     load(HK_ROOT + '/tests/sample_settings.js');
//
// Test data only. It loads the real hk-settings.js and feeds it this, so the
// modules under test read settings exactly the way they do on a page.
var HK_SAMPLE_SETTINGS = {
  configured: true,
  security: {
    alarm: 'alarm_control_panel.alarm_panel_keypad',
    garage: ['binary_sensor.garage_door'],
    locks: ['lock.front_door_lock', 'lock.garage_door_lock', 'lock.back_door_lock', 'lock.crawl_space'],
    doors: ['binary_sensor.front_door_entry', 'binary_sensor.kitchen_back_door', 'binary_sensor.crawl_space_door'],
    windows: ['binary_sensor.kitchen_window_left', 'binary_sensor.kitchen_window_right',
              'binary_sensor.living_room_window_left']
  },
  clock: { time: 'sensor.time', date: 'sensor.date' },
  weather: { entity: 'weather.openweathermap', feels_like: 'sensor.openweathermap_apparent_temperature',
             humidity: 'sensor.openweathermap_humidity', wind: 'sensor.openweathermap_wind_speed',
             uv: 'sensor.openweathermap_uv_index', forecast_daily: 'sensor.weather_daily_forecast',
             forecast_hourly: 'sensor.weather_hourly_forecast', alerts: 'sensor.nws_alerts',
             place: 'HOME · SPRINGFIELD' },
  sky: { moon: 'sensor.moon_phase_fraction', holidays: 'sensor.us_holidays',
         seasonal: 'input_boolean.seasonal_sky',
         birthdays: [{ name: 'Alex', month: 2, day: 4 }, { name: 'Sam', month: 7, day: 10 },
                     { name: 'Jordan', month: 12, day: 16 }] },
  idle: { dashboards: ['dashboard-kitchen', 'dashboard-livingroom', 'dashboard-loft',
                       'dashboard-masterbathroom', 'dashboard-energy', 'dashboard-ecoflow'],
          rooms: { 'dashboard-kitchen': 'kitchen', 'dashboard-livingroom': 'living_room',
                   'dashboard-loft': 'loft', 'dashboard-masterbathroom': 'master_bathroom' },
          'default': 'input_number.tablet_room_idle_default' },
  car: { dashboards: ['dashboard-tesla'] },
  features: { vacuum_script: 'script.my_clean_areas',
              alarm_bad_code: 'input_boolean.alarm_keypad_bad_code' }
};
load((typeof HK_PRODUCT === 'string' ? HK_PRODUCT : HK_ROOT) + '/frontend/modules/hk-settings.js');
window.hkSettings._apply(HK_SAMPLE_SETTINGS);
