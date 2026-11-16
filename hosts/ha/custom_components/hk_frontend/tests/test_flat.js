// Flat's public contract: saved appearance, inheritance, policy and rollback.
load(HK_ROOT + '/tests/dom.js');
document.documentElement = new El('html');
El.prototype.removeAttribute = function(k){delete this.attrs[k]};
load(HK_ROOT + '/frontend/modules/hk-flat-image.js');
load(HK_ROOT + '/frontend/modules/hk-settings.js');
load(HK_ROOT + '/frontend/cards/hk-base.js');
load(HK_ROOT + '/frontend/panels/hk-settings-model.js');
var S=window.hkSettings, C=window.hkCards, M=window.hkSettingsModel, pass=0, fail=0;
function ok(n,c){if(c){pass++;print('PASS '+n)}else{fail++;print('FAIL '+n)}}
var cases=[
 [{},{},false], [{},{flat:true},true], [{glass:'house'},{flat:true},true],
 [{glass:'tinted'},{flat:true},false], [{flat:true,glass:'blur'},{flat:false},true],
 [{flat:false,glass:'house'},{flat:true},false], [{flat:null,glass:'frosted'},{flat:true},false],
 [{flat:null,glass:'house'},{flat:true},true]
];
cases.forEach(function(x,i){ok('inheritance '+i,S.appearance(x[0],x[1]).flat===x[2]);
 ok('settings editor agrees '+i,(M.glassOf(x[0],x[1]).effective==='flat')===x[2]);});
ok('screen theme overrides shared', S.appearance({flat_theme:'light'},{flat_theme:'dark'}).theme==='light');
ok('theme inherits independently', S.appearance({flat:false,flat_theme:null},{flat_theme:'light'}).theme==='light');
// MOTION IS ITS OWN SWITCH (2026-11-14, the owner: "I like the way flat looks, but still want animations, but good to have
// them off for performance reasons ... a setting that lives outside of appearance"): on in every look unless switched
// off, a screen's own over All Screens'; Flat no longer decides it
ok('Motion: on unless switched off, in every look',S.appearance({},{}).motion===true&&S.appearance({},{flat:true}).motion===true&&
    S.appearance({},{motion:false}).motion===false&&S.appearance({},{flat:true,motion:false}).motion===false);
ok('...a screen\'s own over All Screens\'',S.appearance({motion:true},{motion:false}).motion===true&&S.appearance({motion:false},{}).motion===false&&
    S.appearance({motion:null},{motion:false}).motion===false);
S._apply({look:{flat:true,flat_theme:'light',glass:'blur',blur:90},sky:{animations:true,weather:true,decorations:true}});
ok('Flat with Motion on: it moves, with no blur and no live sky all the same',S.glass()==='flat'&&S.rendering().motion===true&&!S.rendering().blur&&!S.rendering().liveSky);
ok('...the cards\' own loops run again there (the weather and the decorations stay off)',S.skyLook().animations===true&&!S.skyLook().weather&&!S.skyLook().decorations);
S._apply({look:{flat:true,flat_theme:'light',motion:true},sky:{animations:false}});
ok('...unless the Background\'s Animations are off',S.skyLook().animations===false);
S._apply({look:{flat:false,glass:'blur',motion:false},sky:{animations:true}});
ok('a glass look with Motion off: still, its blur kept -- and the background keeps its own Animations switch',
    S.rendering().motion===false&&S.rendering().blur===true&&S.skyLook().animations===true);
S.previewMotion(true);
ok('Motion held for this page alone (previewMotion: a check, the Settings preview), then let go',S.rendering().motion===true&&
    (S.previewMotion(null),S.rendering().motion===false));
ok('what holds a card still is keyed on Motion (hk-still), what makes it Flat on Flat',
    /:host\(\[hk-still\]\) \*::after\{animation:none!important;transition:none!important;will-change:auto!important;scroll-behavior:auto!important\}/.test(C.flatCss())&&
    /:host\(\[hk-flat\]\) \*::after\{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;filter:none!important;text-shadow:none!important\}/.test(C.flatCss())&&
    /\.hkd\[hk-still\] :active\{transform:none!important\}/.test(C.flatCss('.hkd[hk-flat]'))&&!/\[hk-flat\][^{}]*\{[^}]*transition:none/.test(C.flatCss()));
S._apply({look:{flat:true,flat_theme:'light',glass:'blur',blur:90,motion:false},sky:{animations:true,weather:true,decorations:true,photo_look:{blur:80,dim:60,saturation:150}}});
ok('Flat with Motion off, as Flat always was: every decorative policy gate closes',S.glass()==='flat'&&!S.rendering().motion&&!S.rendering().blur&&!S.rendering().liveSky&&!S.rendering().autoplay);
ok('sky stops decoration but retains settings',!S.skyLook().animations&&!S.skyLook().weather&&!S.skyLook().decorations&&S.get('sky.animations')===true);
ok('photo effects bypassed',S.photoLook().blur===0&&S.photoLook().dim===0&&S.photoLook().saturate===1);
ok('opaque shared Light material',C.FLAT.light['--hk-glass-plate']==='#FAF9F6'&&document.documentElement.style.getPropertyValue('--hk-glass-plate')==='#FAF9F6');
ok('one stone for recessed keys, wells, pills and segmented tracks',
 ['--hk-key','--hk-look-well','--hk-well-bg','--hk-pill-bg','--hk-seg-track','--acc-seg','--acc-glyph'].every(function(k){return C.FLAT.light[k]===C.FLAT.light['--acc-cell'];}));
ok('secondary labels and form separators share their roles',
 C.FLAT.light['--hk-ink-3']===C.FLAT.light['--hk-ink-2']&&C.FLAT.light['--acc-sep']===C.FLAT.light['--hk-line']&&C.FLAT.light['--acc-fill']===C.FLAT.light['--hk-key-strong']);
ok('off glyphs muted, lit wells bright (Apple light colors)',C.flatColor('rgba(255, 204, 0, 0.98)','glyph')!=='rgba(255, 204, 0, 0.98)'&&C.flatColor('rgba(255, 204, 0, 0.98)','well')==='#FFCC00'&&
    C.flatColor('#ff9f0a','on')==='#FF9500');
S._apply({look:{flat:false,glass:'blur',blur:90},sky:{animations:true,photo_look:{blur:80,dim:60,saturation:150}}});
ok('saved blur strength restored immediately',S.glass()==='blur'&&/36px/.test(document.documentElement.style.getPropertyValue('--hk-blur-filter')));
ok('photo effects restored',S.photoLook().blur===32&&S.photoLook().dim===.6);
ok('normal colors unchanged',C.flatColor('#ffcc00','glyph')==='#ffcc00');
ok('profile CSS includes pseudo-elements and independent motion suppression',/::before/.test(C.flatCss())&&/animation:none!important/.test(C.flatCss())&&
    /backdrop-filter:none!important/.test(C.flatCss()));
// FLAT'S OWN BACKGROUNDS (2026-10-16): Color/Automatic by default, never the live sky
S._apply({look:{flat:true,flat_theme:'dark'},sky:{background:'live',flat_fade:40,flat_pages:{climate:'sage','room-kitchen':'photo',rooms:'landscapes'},page_photos:{'room-kitchen':'/local/k.jpg'}}});
ok('a page left alone with a tone of its own keeps it',S.flatBackground('security',true).color==='auto');
ok('a page left alone without one is the screen background, Automatic',S.flatBackground('energy',false).color==='auto');
ok('a page color',S.flatBackground('climate',true).color==='sage'&&S.flatBackground('climate',true).fade===40);
ok('a room its own photo',S.flatBackground(['room-kitchen','rooms'],false).photo==='/local/k.jpg');
ok('landscapes not listed yet: the ground, not a blank',S.flatBackground(['room-office','rooms'],false).color==='auto');
S._apply({look:{flat:true},sky:{flat_background:'photo',photo:'/local/p.jpg',flat_color:'#123456'}});
ok('screen photo for Home',S.flatBackground(null,false).photo==='/local/p.jpg');
S._apply({look:{flat:true},sky:{flat_background:'color',flat_color:'#123456'}});
ok('screen color for Home',S.flatBackground(null,false).color==='#123456');
ok('tones follow the theme',C.flatColorHex('sage','light','home')==='#EAF0ED'&&C.flatColorHex('sage','dark','home')==='#151C1B');
ok('auto is the page ground: its accent’s shade, else the stone',C.flatColorHex('auto','light','climate')===C.pageTone('climate','light')&&C.flatColorHex('auto','dark','x')==='#17181A');
ok('own hex stays',C.flatColorHex('#ABCDEF','light','home')==='#ABCDEF');
ok('fade 0 is clear, 100 near-opaque',/,0\.000\)$/.test(C.flatFade(0,'dark'))&&/,0\.920\)$/.test(C.flatFade(100,'light')));
ok('chart cards keep their motion',!/::after\{animation:none/.test(C.flatCss(null,true))&&/::after\{animation:none/.test(C.flatCss())&&/backdrop-filter:none/.test(C.flatCss(null,true)));
ok('a clear active well keeps its glyph color (Chrome transparent, Safari none)',/\.well:not\(\[style\*="transparent"\]\):not\(\[style\*="background: none"\]\) \.icon\{color:white/.test(C.flatCss()));
ok('a script-focused sheet gets no ring',/:focus-visible:not\(\[tabindex="-1"\]\)/.test(C.flatCss()));
// (2026-11-15, the owner: "Whats up with the Square boxes around the speakers?" -- Light kept the well the AirPlay way dropped)
ok('Flat Light draws no box behind a speaker\'s glyph in the Speakers panel',!/\.mproom \.ri\{background/.test(read(HK_ROOT+'/frontend/cards/hk-music.js')));
ok('off tiles stay distinct from raised cards; controls share the configuration tone',C.FLAT.light['--hk-tile-off']!==C.FLAT.light['--hk-glass-plate']&&C.FLAT.light['--hk-look-well']===
    C.FLAT.light['--acc-cell']);
ok('Calendar and Weather keep a tone of their own; Home takes the background',C.flatOwnGround('calendar')&&C.flatOwnGround('weather')&&C.flatOwnGround('energy')&&C.flatOwnGround('climate')&&
    !C.flatOwnGround('home'));
ok('Accent Color Automatic reads as Automatic',M.accentOf('auto').auto===true&&M.accentOf('auto').name==='Automatic');
ok('page highlight defaults: dashboard and settings agree',JSON.stringify(C.PAGE_ACCENTS)===JSON.stringify(M.PAGE_ACCENTS));
ok('a page of its own highlight, else its default',M.pageAccentOf('climate',{climate:'green'}).value==='green'&&M.pageAccentOf('climate',{}).value==='blue'&&M.pageAccentOf('climate',{}).own===false);
S._apply({look:{flat:true,flat_theme:'light',page_accents:{climate:'red'}},sky:{}});
ok('a page’s Automatic ground is a shade of its accent',C.flatColorHex('auto','light','climate')!==C.flatColorHex('auto','light','home')&&C.pageTone('climate','light')===
    C.flatColorHex('auto','light','climate')&&C.pageTone('home','light')===null);
ok('red: blush on Light, deep on Dark',/^#f[0-9a-f]e[0-9a-f]/i.test(C.pageTone('climate','light'))&&parseInt(C.pageTone('climate','dark').slice(1,3),16)<60);
// EVERY BACKGROUND IN EVERY STYLE (phase 33, the owner: "keep all background styles available for all modes, including
// flat"): Flat over the Live Sky or a Wallpaper hands the sky its own (resolve draws it behind Flat's cards); a page with
// a tone of its own keeps it; the sky's weather, decorations and animations go by the glass looks' switches
S._apply({look:{flat:true,flat_theme:'dark',motion:false},sky:{flat_background:'live',background:'wallpaper',animations:true,weather:true,decorations:true,
  flat_pages:{timeline:'live',lights:'wallpaper'}}});
ok('Flat over the Live Sky: the screen\'s pages draw the sky',S.flatBackground(null,false).live===true&&S.flatBackground('energy',false).live===true);
ok('...a page with a tone of its own keeps it',S.flatBackground('security',true).color==='auto');
ok('...a page set to the Live Sky has the live ramp itself, one set to a Wallpaper the wallpaper',
    S.flatBackground('timeline',false).live===true&&S.flatBackground('timeline',false).backdrop===false&&S.flatBackground('lights',true).wallpaper===true);
ok('...its weather, decorations and animations by the same switches as the glass looks (Motion apart)',S.skyLook().weather===true&&
    S.skyLook().decorations===true&&S.skyLook().animations===true&&S.rendering().flat===true);
ok('...and the slow-tablet ladder counts what it costs',/^flat:a1w1r1f0c0$/.test(S.ladderSignature()),S.ladderSignature());
S._apply({look:{flat:true,motion:false},sky:{flat_background:'live',animations:false,weather:false}});
ok('...switched off, they stay off',S.skyLook().animations===false&&S.skyLook().weather===false);
S._apply({look:{flat:true},sky:{flat_background:'wallpaper',wallpaper_motion:'slow',animations:true}});
ok('Flat over a Wallpaper: the wallpaper, and its motion counted',S.flatBackground(null,false).wallpaper===true&&/^flat:a1w0r0f0c0$/.test(S.ladderSignature()));
S._apply({look:{flat:true,motion:false},sky:{flat_background:'color',background:'live',animations:true,weather:true,decorations:true}});
ok('Flat over a Color draws as it did: no sky, nothing that moves, nothing counted',S.flatBackground(null,false).color==='auto'&&!S.skyLook().weather&&
    !S.skyLook().decorations&&!S.skyLook().animations&&/^flat:a0w0r0f0c0$/.test(S.ladderSignature()));
// CARRIED OVER (phase 33, decision 8: Adjust Photo keeps every treatment): a look stored the old way draws as it did
S._apply({look:{flat:false,glass:'blur'},sky:{background:'landscapes',landscape_look:{blur:0,dim:55,saturation:100,tint:'',tint_amount:35}}});
var bgL=S.skyLook().background.look;
ok('a landscape\'s Blur & Dim stored the old way (All Screens\' landscape_look) draws the same',bgL.blur===0&&bgL.dim===0.55&&bgL.saturate===1&&bgL.tint===null&&!bgL.image);
S._apply({look:{flat:false,glass:'blur'},sky:{background:'photo',photo:'/local/p.jpg',image_look:{mode:'tinted',strength:80,depth:40,brightness:0,fade:35}}});
ok('...the glass looks\' starting point (Balanced) the same',JSON.stringify(S.photoLook().image)===JSON.stringify({mode:'tinted',color:'accent',strength:80,depth:40,brightness:0,fade:35}));
S._apply({look:{flat:true},sky:{flat_background:'photo',photo:'/local/p.jpg',flat_image_look:{mode:'tinted',strength:100,depth:85,brightness:-5,fade:15}}});
ok('a Flat starting point stored as a preset (Rich) draws the same',JSON.stringify(S.flatBackground(null,false).imageLook)===
    JSON.stringify({mode:'tinted',color:'accent',strength:100,depth:85,brightness:-5,fade:15}));
S._apply({look:{flat:true},sky:{flat_background:'photo',photo:'/local/p.jpg',flat_fade:40,flat_tint:'#112233',flat_tint_amount:70,flat_tint_light:30}});
var fb=S.flatBackground(null,false);
ok('Flat\'s older Fade and Tint draw the same (Previous Look)',fb.photo==='/local/p.jpg'&&fb.fade===40&&fb.tint==='#112233'&&fb.tintAmount===70&&fb.tintLight===30&&
    fb.imageLook.mode==='legacy');
if(fail)throw Error(fail+' failed');print('ALL '+pass+' FLAT TESTS PASS');
