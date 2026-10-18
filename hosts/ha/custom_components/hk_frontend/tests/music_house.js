// THE HOUSE, as the HK Frontend integration hands it to a screen over
// `hk_music/subscribe` (music.py MusicConfig.as_client) -- the shape
// the music cards read through hkMusic: nine rooms on two floors, two
// presets and a few playlists. Load after hk-base.js:
//
//     load(HK_ROOT + '/tests/music_house.js');   // configures hkMusic
//
// Playlist keys are subentry ids in a real setup; here they are readable names.
var HK_ROOMS = ['kitchen', 'living_room', 'master_bedroom', 'master_bathroom',
                'guest_bedroom', 'office', 'kids_room', 'extra_room', 'loft']
  .map(function (k) { return 'media_player.' + k + '_homepod_ma'; });
var HK_ROOM_NAMES = ['Kitchen', 'Living Room', 'Master Bedroom', 'Master Bathroom',
                     'Guest Bedroom', 'Office', "Kid's Room", 'Extra Room', 'Loft'];
var HK_HOUSE = {
  configured: true,
  speakers: [
    { name: 'Everywhere', entity: 'media_player.homepods_2', members: HK_ROOMS.slice() },
    { name: 'Downstairs', entity: 'media_player.downstairs_homepods_downstairs',
      members: HK_ROOMS.slice(0, 5) }
  ].concat(HK_ROOMS.map(function (e, i) { return { name: HK_ROOM_NAMES[i], entity: e }; })),
  floors: [
    { name: 'Main Floor', entities: HK_ROOMS.slice(0, 5) },
    { name: 'Upstairs', entities: HK_ROOMS.slice(5) }
  ],
  playlists: [
    { name: 'Favorites Mix', icon: 'hk:star-fill', key: 'favorites_mix' },
    { name: 'Christmas', icon: 'hk:christmas-tree', key: 'christmas' },
    { name: 'Decades', icon: 'hk:timer-sand', options: [
      { name: '2020s', key: 'decade_2020s' },
      { name: '2010s', key: 'decade_2010s' },
      { name: '2000s', key: 'decade_2000s' } ] }
  ],
  home: null,
  volume: 0.35,
  library_entry: 'ma-entry'
};
window.hkMusic._configure(HK_HOUSE);
