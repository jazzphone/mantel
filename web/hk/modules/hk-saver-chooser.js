// @ts-check
// A device-local chooser. It never writes house settings or a tablet switch.
(function () {
  'use strict';
  function open(o) {
    var host = document.createElement('hk-saver-chooser'), sr = host.attachShadow({ mode: 'open' }), ctls = [];
    var css = document.createElement('style');
      css.textContent =
      ':host{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:#080a12ed;color:white;font:16px system-ui,sans-serif;backdrop-filter:blur(16px)}' +
      'section{width:100%;max-width:1300px;box-sizing:border-box;padding:24px;max-height:100%;overflow-y:auto}header{display:flex;gap:16px;align-items:center;flex-wrap:wrap}h1{flex:1;' +
      'font-size:24px;min-width:0}@media(max-width:600px){header{gap:8px}h1{flex-basis:100%;margin:8px 0}header button{padding:10px 12px}}button{border:0;min-height:44px;padding:10px 20px;' +
      'border-radius:14px;color:inherit;background:#ffffff20;font:inherit;cursor:pointer}.rail{display:flex;overflow:auto;scroll-snap-type:x mandatory;overscroll-behavior-x:contain;gap:24px;' +
      'padding:30px 8px;scroll-padding:8px}.card{flex:0 0 min(72vw,560px);scroll-snap-align:center;padding:10px;text-align:left;border:2px solid transparent}' +
      '.card[aria-pressed=true]{border-color:#80b6ff}.picture{height:min(50vh,380px);position:relative;overflow:hidden;border-radius:10px;background:linear-gradient(135deg,#314c69,#111624)}' +
      '.picture>div{position:absolute;inset:0;container-type:size}.name{padding:14px 6px 6px;font-size:20px}.note{opacity:.7;line-height:1.5}button:focus-visible{outline:3px solid #80b6ff;' +
      'outline-offset:3px}'; sr.appendChild(css);
    var section=document.createElement('section');section.setAttribute('role','dialog');section.setAttribute('aria-modal','true');section.setAttribute('aria-label','Choose Screensaver');
      sr.appendChild(section);
    var head=document.createElement('header'),title=document.createElement('h1');title.textContent='Your Screensavers';head.appendChild(title);section.appendChild(head);
    function button(label, fn, parent) { var b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);parent.appendChild(b);return b; }
    var closed=false;
    function close() {if(closed)return;closed=true;ctls.forEach(function(c){if(c)c.destroy();});host.remove();o.close();}
    if(o.local&&o.reset)button('Use Saved Default',function(){o.reset();close();},head);
    if(o.edit)button('Customize',function(){close();o.edit();},head);
    var done=button('Done',close,head),rail=document.createElement('div');rail.className='rail';rail.setAttribute('aria-label','Saved screensavers. Swipe to browse.');section.appendChild(rail);
    function showClocks() {
      var C=window.hkSaverClock;if(!C)return;
      Array.from(rail.children).forEach(function(card,i){var d=o.designs[i],v=d.options,layer=card.querySelector('.picture>div');
        if(v.show==='clock')ctls.push(C.mount(layer,{style:v.clock_style,options:v.clock_options,color:(v.clock_colors||{})[v.clock_style],h24:v.clock_24,bg:v.clock_bg,still:true,drift:false,
          client:o.client}));
        else {var t=document.createElement('div');t.style.cssText='display:grid;place-items:center;height:100%;font-size:clamp(28px,7vw,88px);font-weight:300';
          t.textContent=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date());layer.appendChild(t);}
      });
    }
    o.designs.forEach(function(d){var b=button('',function(){o.select(d);Array.from(rail.children).forEach(function(n){n.setAttribute('aria-pressed',n===b?'true':'false');});},rail);
      b.className='card';b.setAttribute('aria-pressed',d.id===o.active?'true':'false');
      var pic=document.createElement('div');pic.className='picture';pic.inert=true;pic.appendChild(document.createElement('div'));b.appendChild(pic);var name=document.createElement('div');
        name.className='name';name.textContent=d.name;b.appendChild(name);
    });
    var note=document.createElement('p');note.className='note';note.textContent=o.designs.length?
      'Tap a design to remember it on this device. Changes to this screen’s saved settings restore its saved default. Customize saves designs through Settings.':
      'No saved designs yet. Add designs in the Screensaver editor.';section.appendChild(note);
    sr.addEventListener('keydown',function(event){var e=/** @type {KeyboardEvent} */(event);
      if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){var all=Array.from(sr.querySelectorAll('button')),at=all.indexOf(/** @type {HTMLButtonElement} */(sr.activeElement));
      if(e.shiftKey&&at<=0){e.preventDefault();all[all.length-1].focus();}else if(!e.shiftKey&&at===all.length-1){e.preventDefault();all[0].focus();}}});
    (o.parent||document.body).appendChild(host);done.focus();
    if(window.hkSaverClock)showClocks();else import('/hk/modules/hk-saverclock.js').then(function(){if(host.isConnected)showClocks();});
    return { close: close, host: host };
  }
  window.hkSaverChooser={open:open};
})();
