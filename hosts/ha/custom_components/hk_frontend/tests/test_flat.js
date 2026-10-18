// Flat's public contract: saved appearance, inheritance, policy and rollback.
load(HK_ROOT + '/tests/dom.js');
document.documentElement = new El('html');
El.prototype.removeAttribute = function(k){delete this.attrs[k]};
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
S._apply({look:{flat:true,flat_theme:'light',glass:'blur',blur:90},sky:{animations:true,weather:true,decorations:true,photo_look:{blur:80,dim:60,saturation:150}}});
ok('all decorative policy gates close',S.glass()==='flat'&&!S.rendering().motion&&!S.rendering().blur&&!S.rendering().liveSky&&!S.rendering().autoplay);
ok('sky stops decoration but retains settings',!S.skyLook().animations&&!S.skyLook().weather&&!S.skyLook().decorations&&S.get('sky.animations')===true);
ok('photo effects bypassed',S.photoLook().blur===0&&S.photoLook().dim===0&&S.photoLook().saturate===1);
ok('opaque shared Light material',C.FLAT.light['--hk-glass-plate']==='#FAF9F6'&&document.documentElement.style.getPropertyValue('--hk-glass-plate')==='#FAF9F6');
ok('one stone for recessed keys, wells, pills and segmented tracks',
 ['--hk-key','--hk-look-well','--hk-well-bg','--hk-pill-bg','--hk-seg-track','--acc-seg','--acc-glyph'].every(function(k){return C.FLAT.light[k]===C.FLAT.light['--acc-cell'];}));
ok('secondary labels and form separators share their roles',
 C.FLAT.light['--hk-ink-3']===C.FLAT.light['--hk-ink-2']&&C.FLAT.light['--acc-sep']===C.FLAT.light['--hk-line']&&C.FLAT.light['--acc-fill']===C.FLAT.light['--hk-key-strong']);
ok('off glyphs muted, lit wells bright (Apple light colors)',C.flatColor('rgba(255, 204, 0, 0.98)','glyph')!=='rgba(255, 204, 0, 0.98)'&&C.flatColor('rgba(255, 204, 0, 0.98)','well')==='#FFCC00'&&C.flatColor('#ff9f0a','on')==='#FF9500');
S._apply({look:{flat:false,glass:'blur',blur:90},sky:{animations:true,photo_look:{blur:80,dim:60,saturation:150}}});
ok('saved blur strength restored immediately',S.glass()==='blur'&&/36px/.test(document.documentElement.style.getPropertyValue('--hk-blur-filter')));
ok('photo effects restored',S.photoLook().blur===32&&S.photoLook().dim===.6);
ok('normal colors unchanged',C.flatColor('#ffcc00','glyph')==='#ffcc00');
ok('profile CSS includes pseudo-elements and independent motion suppression',/::before/.test(C.flatCss())&&/animation:none!important/.test(C.flatCss())&&/backdrop-filter:none!important/.test(C.flatCss()));
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
ok('off tiles stay distinct from raised cards; controls share the configuration tone',C.FLAT.light['--hk-tile-off']!==C.FLAT.light['--hk-glass-plate']&&C.FLAT.light['--hk-look-well']===C.FLAT.light['--acc-cell']);
ok('Calendar and Weather keep a tone of their own; Home takes the background',C.flatOwnGround('calendar')&&C.flatOwnGround('weather')&&C.flatOwnGround('energy')&&C.flatOwnGround('climate')&&!C.flatOwnGround('home'));
ok('Highlight Color Automatic reads as Automatic',M.accentOf('auto').auto===true&&M.accentOf('auto').name==='Automatic');
ok('page highlight defaults: dashboard and settings agree',JSON.stringify(C.PAGE_ACCENTS)===JSON.stringify(M.PAGE_ACCENTS));
ok('a page of its own highlight, else its default',M.pageAccentOf('climate',{climate:'green'}).value==='green'&&M.pageAccentOf('climate',{}).value==='blue'&&M.pageAccentOf('climate',{}).own===false);
S._apply({look:{flat:true,flat_theme:'light',page_accents:{climate:'red'}},sky:{}});
ok('a page’s Automatic ground is a shade of its accent',C.flatColorHex('auto','light','climate')!==C.flatColorHex('auto','light','home')&&C.pageTone('climate','light')===C.flatColorHex('auto','light','climate')&&C.pageTone('home','light')===null);
ok('red: blush on Light, deep on Dark',/^#f[0-9a-f]e[0-9a-f]/i.test(C.pageTone('climate','light'))&&parseInt(C.pageTone('climate','dark').slice(1,3),16)<60);
if(fail)throw Error(fail+' failed');print('ALL '+pass+' FLAT TESTS PASS');
