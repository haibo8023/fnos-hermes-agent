import{X as e}from"./i18n-BcQqUASK.js";import{s as t}from"./pane-visibility-DDcgRsdO.js";import{r as n,t as r}from"./preview-script-runner-BzZoXtlh.js";function i(e,t){return!(`x`in e)||!t||!Number.isFinite(t)||t<=0||t===1?e:{...e,x:Math.round(e.x*t),y:Math.round(e.y*t)}}var a=new Map;function o(e,t){return a.set(e,t),()=>{a.get(e)===t&&a.delete(e)}}function s(e){let t=n(e);return t&&a.get(t.id)||null}var c=`data-preview-browser`,l=new Map;function u(e,t){return l.set(e,t),()=>{l.get(e)===t&&l.delete(e)}}function d(e){let t=n(e);return t&&l.get(t.id)||null}function f(e){let n=document.activeElement?.closest(`[${c}]`),r=n&&!t(n)?l.get(n.getAttribute(`data-preview-browser`)||``):void 0;return r?.[e](),!!r}function p(e){let t=(e,t)=>{let n=!!t.disabled,r=t.value||``;if(e.label===t.label&&e.value===r&&e.off===n)return null;let i={ref:e.ref};return e.label!==t.label&&(i.label=t.label),e.value!==r&&(i.value=r),e.off!==n&&(i.disabled=n),i},n=(e,t)=>{if(!e||!t)return!1;let n=e.toLowerCase().split(/\s+/).filter(Boolean),r=t.toLowerCase().split(/\s+/).filter(Boolean),i=n.filter(e=>r.indexOf(e)!==-1).length,a=n.length+r.filter(e=>n.indexOf(e)===-1).length;return a>0&&i/a>=.5};return{affinity:(e,t)=>{if(e.role!==t.role)return 0;if(e.stable&&t.stable)return+(e.stable===t.stable);let r=0;return e.name&&e.name===t.name?r+=.6:n(e.name,t.name)&&(r+=.4),e.path&&e.path===t.path&&(r+=.3),r},alike:n,coin:(t,n,r)=>{let i=e.slug(r),a=e.stemOf(n)+(i?`-`+i:``),o=t[a]||0;return t[a]=o+1,o?a+`-`+o:a},shifted:t}}function m(e){let t=e=>typeof CSS<`u`&&CSS.escape?CSS.escape(e):e.replace(/["\\]/g,`\\$&`),n=(e,t)=>e.length>t?e.slice(0,t-1)+`…`:e,r=t=>{let r=t.getAttribute(`aria-label`);if(r)return n(r,80);let i=t.getAttribute(`aria-labelledby`),a=(((i?e.getElementById(i):null)||t).textContent||``).trim().replace(/\s+/g,` `);if(a)return n(a,80);for(let e of[`placeholder`,`title`,`alt`,`name`,`value`]){let r=t.getAttribute(e);if(r)return n(r,80)}return``},i=e=>e.id||e.getAttribute(`data-testid`)||e.getAttribute(`name`)||e.getAttribute(`aria-label`)||``,a=e=>e===`button`||e===`summary`?`btn`:e===`a`||e===`link`?`lnk`:e===`input:search`||e===`searchbox`?`srch`:e===`input:checkbox`||e===`checkbox`?`chk`:e===`input:radio`||e===`radio`?`rdo`:e===`select`||e===`combobox`?`sel`:e===`textarea`?`txt`:e===`switch`?`sw`:e===`tab`||e===`menuitem`||e===`option`?e===`menuitem`?`mi`:e===`option`?`opt`:`tab`:e.indexOf(`input`)===0||e===`textbox`?`inp`:`el`,o=e=>{let t=``,n=!1;for(let r=0;r<e.length&&t.length<24;r++){let i=e[r];/[a-zA-Z0-9]/.test(i)?(t+=i.toLowerCase(),n=!1):!n&&t&&(t+=`-`,n=!0)}return t.replace(/-+$/,``)};return{anchorOf:e=>{let t=e.closest(`main,nav,header,footer,aside,[role="main"],[role="navigation"],[role="banner"],[role="contentinfo"],[role="complementary"],[role="search"],form[aria-label],section[aria-label]`);if(!t)return`root`;let n=t.getAttribute(`aria-label`)||``;return t.tagName.toLowerCase()+(n?`#`+o(n):``)},clamp:n,cssEscape:t,labelOf:r,selectorFor:e=>{if(e.id)return`#`+t(e.id);let n=e.getAttribute(`data-testid`);return n?`[data-testid="`+t(n)+`"]`:``},slug:o,stableOf:i,stemOf:a,valueOf:e=>{let t=e,r=(t.type||``).toLowerCase();if(r===`checkbox`||r===`radio`)return t.checked?`checked`:`unchecked`;let i=e.getAttribute(`role`)||``;return i===`checkbox`||i===`radio`||i===`switch`?e.getAttribute(`aria-checked`)===`true`?`checked`:`unchecked`:typeof t.value==`string`&&t.value?n(t.value,60):``}}}function h(e,t){let n=e=>{if(!t)return!1;let n=e.getBoundingClientRect();return n.right<=0||n.bottom<=0||n.left>=t.innerWidth||n.top>=t.innerHeight?!1:!(n.width>=t.innerWidth*.95&&n.height>=t.innerHeight*.9)},r=e=>{let n=e.checkVisibility;if(typeof n==`function`&&!n.call(e,{checkOpacity:!0,checkVisibilityCSS:!0}))return!1;let r=t&&t.getComputedStyle?t.getComputedStyle(e):null;return!(r&&(r.display===`none`||r.visibility===`hidden`||r.opacity===`0`||r.clip&&r.clip!==`auto`||(r.clipPath||``).indexOf(`inset(50%`)!==-1))};return{onScreen:n,shown:r,visible:n=>{if(!r(n)||n.closest(`[aria-hidden="true"], [inert]`))return!1;let i=n.getBoundingClientRect();if(i.right<=0||i.bottom<=0||i.width<3||i.height<3)return!1;let a=i.left+i.width/2,o=i.top+i.height/2,s=e.elementFromPoint;if(typeof s==`function`&&t&&a>=0&&o>=0&&a<t.innerWidth&&o<t.innerHeight){let t=s.call(e,a,o);if(!t||!(t===n||n.contains(t)||t.contains(n)))return!1}return!0}}}function g(e,t,n,r){let{anchorOf:i,labelOf:a,selectorFor:o,stableOf:s,valueOf:c}=r.naming,{affinity:l,coin:u,shifted:d}=r.identity,{onScreen:f,visible:p}=r.visibility,m=e.defaultView,h=e.location?e.location.href:``,g=m&&m.matchMedia&&m.matchMedia(`(prefers-reduced-motion: reduce)`).matches?`auto`:`smooth`,_=n=>{let r=[],i=[],s=[],l=e.querySelectorAll(`a[href], button, input:not([type="hidden"]), select, textarea, summary, label[for], [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="switch"], [role="option"], [role="combobox"], [role="searchbox"], [role="textbox"], [contenteditable=""], [contenteditable="true"], [onclick], [tabindex]:not([tabindex="-1"])`);for(let e of l){if(s.length>=n&&i.length>=600)break;if(!p(e)||(i.length<600&&f(e)&&i.push(e),s.length>=n))continue;let t=e.tagName.toLowerCase(),l=e.getAttribute(`role`)||(t===`input`?`input:`+(e.type||`text`):t),u=a(e),d=c(e);if(!u&&!d)continue;let m={label:u,ref:``,role:l},h=o(e);h&&(m.selector=h),e.disabled&&(m.disabled=!0),d&&(m.value=d),r.push(e),s.push(m)}return t.nodes=r,t.field=i,{elements:s,nodes:r}},v=r=>{let a=t.url!==h;a&&(t.book=[],t.coined={});let o=t.book||=[],c=t.coined||={},f=_(r),m={},g=[],v=[],y=[],b=[],x=new Map,S=[],C=0;for(let e of o)x.set(e.el,e);for(let e=0;e<f.elements.length;e++){let t=f.elements[e],n=x.get(f.nodes[e]);if(!n){S.push(e);continue}let r=d(n,t);if(t.ref=n.ref,m[n.ref]=!0,g.push(n),!r){C++;continue}n.label=t.label,n.name=t.label||t.value||``,n.off=!!t.disabled,n.value=t.value||``,y.push(r)}let w=o.filter(t=>!m[t.ref]&&!e.contains(t.el));for(let e of S){let t=f.elements[e],n=f.nodes[e],r={el:n,label:t.label,name:t.label||t.value||``,off:!!t.disabled,path:i(n),ref:``,role:t.role,stable:s(n),value:t.value||``},a,o=0;for(let e of w){if(m[e.ref])continue;let t=l(e,r);t>=.6&&t>o&&(a=e,o=t)}if(a){t.ref=a.ref,a.el=n,a.label=r.label,a.name=r.name,a.off=r.off,a.path=r.path,a.stable=r.stable,a.value=r.value,m[a.ref]=!0,g.push(a),b.push(a.ref);continue}r.ref=u(c,t.role,r.name),t.ref=r.ref,m[r.ref]=!0,g.push(r),v.push(t)}let T=[];for(let t of o)if(!m[t.ref]){if(e.contains(t.el)&&p(t.el)){g.push(t);continue}T.push(t.ref)}t.book=g,t.url=h;let E=v.length+y.length;if(a||n.full||E*2>=f.elements.length)return{elements:f.elements,success:!0};let D={same:C};return v.length&&(D.added=v),y.length&&(D.changed=y),T.length&&(D.removed=T),b.length&&(D.rebound=b),{delta:D,success:!0}},y=()=>{let r=(n.ref||``).trim();if(r){if(t.url!==h)return{error:`The page navigated since the last snapshot, so `+r+` no longer points anywhere. Call elements again.`};let n=(t.book||[]).filter(e=>e.ref===r)[0];return n?e.contains(n.el)?{el:n.el}:{error:r+` has been removed from the page since the last snapshot. Call elements again.`}:{error:`Unknown element `+r+`. Call elements to get current refs.`}}let i=(n.selector||``).trim();if(!i)return{error:`Pass a ref from elements, or a CSS selector.`};let a=null;try{a=e.querySelector(i)}catch{return{error:`Not a valid CSS selector: `+i}}return a?{el:a}:{error:`No element matches `+i+`.`}},b=e=>{let t=a(e);return e.tagName.toLowerCase()+(t?` "`+t+`"`:``)},x=t=>({...t,title:e.title||``,url:e.location?e.location.href:``}),S=e=>x({error:e,success:!1}),C=e=>{let t=e.getBoundingClientRect();return{clientX:Math.round(t.left+t.width/2),clientY:Math.round(t.top+t.height/2)}};if(n.kind===`elements`){let e=v(Math.max(1,Math.min(n.max||120,120))),t=!e.delta&&!(e.elements||[]).length;return x({...e,note:t?`No interactive elements found — the page may still be loading.`:void 0})}if(n.kind===`scroll`){let e=n.ref||n.selector?y():{};if(e.error)return S(e.error);let t=e.el||null,r=Math.round((m?m.innerHeight:800)*.9),i=n.to===`top`?-1e7:n.to===`bottom`?1e7:n.amount??r;return t?t.scrollBy({behavior:g,top:i}):m&&m.scrollBy({behavior:g,top:i}),x({acted:t?`scrolled `+b(t):`scrolled the page`,success:!0})}let w=y();if(w.error||!w.el)return S(w.error||`No target.`);let T=w.el;if(t.aimed=T,n.kind===`locate`){T.scrollIntoView&&T.scrollIntoView({behavior:`instant`,block:`center`,inline:`nearest`}),n.focus&&T.focus();let e=C(T),t=T.tagName;return x({acted:`looking at `+b(T),point:{x:e.clientX,y:e.clientY},success:!0,tag:t,typable:t===`TEXTAREA`||t===`INPUT`||T.isContentEditable===!0})}if(T.scrollIntoView&&T.scrollIntoView({behavior:`instant`,block:`center`,inline:`nearest`}),n.kind===`hover`){let e={bubbles:!0,cancelable:!0,...C(T)};return typeof PointerEvent==`function`&&(T.dispatchEvent(new PointerEvent(`pointerover`,e)),T.dispatchEvent(new PointerEvent(`pointermove`,e))),T.dispatchEvent(new MouseEvent(`mouseover`,e)),T.dispatchEvent(new MouseEvent(`mousemove`,e)),x({acted:`hovered over `+b(T),success:!0})}if(T.disabled)return S(b(T)+` is disabled.`);if(n.kind===`click`){let e={bubbles:!0,cancelable:!0,...C(T)};return typeof PointerEvent==`function`&&(T.dispatchEvent(new PointerEvent(`pointerdown`,e)),T.dispatchEvent(new PointerEvent(`pointerup`,e))),T.dispatchEvent(new MouseEvent(`mousedown`,e)),T.dispatchEvent(new MouseEvent(`mouseup`,e)),T.click(),x({acted:`clicked `+b(T),success:!0})}if(n.kind===`type`){let e=n.text??``,t=T.isContentEditable||(T.getAttribute(`contenteditable`)??`false`)!==`false`;if(T.focus(),t)try{document.execCommand(`insertText`,!1,e)}catch{T.textContent=e,T.dispatchEvent(new InputEvent(`input`,{data:e,inputType:`insertText`,bubbles:!0}))}else if(T.tagName===`INPUT`||T.tagName===`TEXTAREA`){let t=T.tagName===`TEXTAREA`?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,n=Object.getOwnPropertyDescriptor(t,`value`)?.set;n?n.call(T,e):T.value=e}else if(T.tagName===`SELECT`)return S(b(T)+` is a dropdown — click it and click the option you want.`);else return S(b(T)+` is not a text field.`);if(T.dispatchEvent(new InputEvent(`input`,{data:e,inputType:`insertText`,bubbles:!0})),T.dispatchEvent(new Event(`change`,{bubbles:!0})),n.submit){let e={bubbles:!0,cancelable:!0,code:`Enter`,key:`Enter`,keyCode:13,which:13};T.dispatchEvent(new KeyboardEvent(`keydown`,e)),T.dispatchEvent(new KeyboardEvent(`keyup`,e));let t=T.form;t&&(t.requestSubmit?t.requestSubmit():t.submit())}return x({acted:`typed into `+b(T)+(n.submit?` and submitted`:``),success:!0})}if(n.kind===`press`){let e=n.key||``;if(!e)return S(`Pass the key to press, e.g. "Enter" or "Escape".`);let t=T.tagName===`BODY`||T.tagName===`HTML`;if(e.length===1&&t&&n.allowShortcut!==!0)return S(`Refused to press a printable key on `+T.tagName+`. That would be a page shortcut; pass allowShortcut to opt in.`);let r={bubbles:!0,cancelable:!0,code:e.length===1?`Key`+e.toUpperCase():e,key:e};return T.focus(),T.dispatchEvent(new KeyboardEvent(`keydown`,r)),T.dispatchEvent(new KeyboardEvent(`keyup`,r)),x({acted:`pressed `+e+` on `+b(T),success:!0})}return S(`Unknown action: `+String(n.kind))}function _(){return`(function (doc, holder, action) {
  var naming = (${m.toString()})(doc);
  var kit = {
    naming: naming,
    identity: (${p.toString()})(naming),
    visibility: (${h.toString()})(doc, doc.defaultView)
  };
  return (${g.toString()})(doc, holder, action, kit);
})`}function v(e,t,n,r){let i=e.defaultView;if(!i||!e.documentElement)return;let a=`#EC008C`,o=6e3,s=!!(i.matchMedia&&i.matchMedia(`(prefers-reduced-motion: reduce)`).matches),c=i.matchMedia&&i.matchMedia(`(prefers-color-scheme: dark)`).matches?`#FFFFFF`:`#111111`,l=i.__hermesWatch||={},u={candidate:{gap:0,life:o,rule:`1.5px`},flash:{gap:4,life:90,rule:`2px`},held:{gap:4,life:0,rule:`2px`},hit:{gap:0,life:o,rule:`2px`},lock:{gap:4,life:7500,rule:`2px`}},d=(e,t)=>{for(let n in t)e.style.setProperty(n,t[n])},f=e=>{let t=e.tagName.toLowerCase(),n=e.getAttribute(`id`),r=(e.getAttribute(`class`)||``).trim().split(/\s+/)[0],i=e.getAttribute(`type`)||e.getAttribute(`name`)||e.getAttribute(`role`);if(n)return t+`#`+n;if(r)return t+`.`+r;if(i)return t+`[`+i+`]`;let a=e.parentElement;if(!a)return t;let o=0,s=0;for(let t=0;t<a.children.length;t++)a.children[t].tagName===e.tagName&&(o++,a.children[t]===e&&(s=o));return o>1?t+`[`+s+`]`:t},p=e=>{let n=t.book||[];for(let t of n)if(t.el===e)return t.ref;let r=f(e);return r.length>16?r.slice(0,15)+`…`:r},m=e=>{let t=e.getBoundingClientRect();return{height:t.height,left:t.left,top:t.top,width:t.width}},h=e=>({x:e.left+e.width/2,y:e.top+e.height/2}),g=()=>{let t=e.querySelectorAll(`hermes-watch`);for(let e=0;e<t.length;e++)t[e].remove();let n=e.createElement(`hermes-watch`);n.setAttribute(`aria-hidden`,`true`),n.setAttribute(`popover`,`manual`),d(n,{background:`transparent`,border:`0`,contain:`layout style paint`,display:`block`,height:`100%`,inset:`0`,margin:`0`,overflow:`visible`,padding:`0`,"pointer-events":`none`,position:`fixed`,"user-select":`none`,width:`100%`,"z-index":`2147483647`});let r=n.attachShadow({mode:`closed`}),i=e.createElement(`div`);d(i,{left:`0`,opacity:`0`,"pointer-events":`none`,position:`fixed`,top:`0`});let a=l.at;a&&d(i,{transform:`translate3d(`+a.x+`px,`+a.y+`px,0)`});let o=e.createElementNS(`http://www.w3.org/2000/svg`,`svg`);o.setAttribute(`viewBox`,`0 0 24 36`),o.setAttribute(`width`,`28`),o.setAttribute(`height`,`42`),d(o,{display:`block`,left:`-1px`,position:`absolute`,top:`-1px`});let c=e.createElementNS(`http://www.w3.org/2000/svg`,`path`);return c.setAttribute(`d`,`M5.65376 12.3673H5.46026L5.31717 12.4976L0.500002 16.8829L0.500002 1.19841L11.7841 12.3673H5.65376Z`),o.appendChild(c),i.appendChild(o),r.appendChild(i),e.documentElement.appendChild(n),!s&&typeof o.animate==`function`&&o.animate([{transform:`translate(0px, 0px)`},{transform:`translate(1.5px, -2px)`},{transform:`translate(-1px, 1.5px)`},{transform:`translate(0px, 0px)`}],{duration:5200,easing:`ease-in-out`,iterations:1/0}),{cursor:o,host:n,nib:c,pointer:i,shadow:r}},_=e=>{let t=l.parts;l.at=e,t&&d(t.pointer,{transform:`translate3d(`+e.x+`px,`+e.y+`px,0)`})},v=l.marks||=[],y=t=>{let n=e.createElement(`div`);return n.textContent=t,d(n,{background:a,color:`#FFFFFF`,"font-family":`-apple-system, 'Helvetica Neue', Arial, sans-serif`,"font-size":`8px`,"font-weight":`700`,"letter-spacing":`0.04em`,"line-height":`1.4`,"max-width":`160px`,overflow:`hidden`,padding:`0 2px`,position:`absolute`,"text-transform":`uppercase`,"white-space":`nowrap`}),n},b=t=>{let n=e.createElement(`div`);d(n,{color:a,left:`0`,"pointer-events":`none`,position:`fixed`,top:`0`});let r=e.createElement(`div`);if(d(r,{border:u[t.kind].rule+` solid currentColor`,inset:`0`,overflow:`hidden`,position:`absolute`,"transform-origin":`center`}),n.appendChild(r),t.kind===`lock`){let t=e.createElement(`div`);d(t,{background:`currentColor`,height:`2px`,left:`0`,opacity:`0`,position:`absolute`,right:`0`,top:`0`}),r.appendChild(t)}let i=t.label?y(t.label):void 0;return i&&n.appendChild(i),{cell:n,skin:r,tag:i}},x=e=>{let t=e.cell,n=m(e.spec.a),r=u[e.spec.kind].gap;if(d(t,{height:n.height+r*2+`px`,transform:`translate3d(`+(n.left-r)+`px,`+(n.top-r)+`px,0)`,width:n.width+r*2+`px`}),e.tag){let t=n.top-r>=13?`up`:n.top+n.height+r+13<=i.innerHeight?`down`:`in`,a=e.wide||=e.tag.offsetWidth,o=n.left-r+a>i.innerWidth?`end`:`start`,s=t+o;e.slot!==s&&(e.slot=s,d(e.tag,{bottom:t===`up`?`100%`:``,left:o===`start`?`0px`:``,right:o===`end`?`0px`:``,top:t===`up`?``:t===`down`?`100%`:`0`}))}return h(n)},S=e=>{let t=e.spec,n=t.life||u[t.kind].life;if(!n)return;let r=e.cell,a=e.skin,c=t.beat||0;i.setTimeout(()=>r.remove(),n+c);let l=t.kind===`candidate`||t.kind===`flash`,d=l?r:a;if(s||typeof d.animate!=`function`)return;let f=l?[{offset:0,opacity:0},{offset:.01,opacity:1},{offset:.99,opacity:1},{offset:1,opacity:0}]:[{offset:0,transform:t.kind===`hit`?`scale(1.35)`:`scale(1.06)`},{offset:t.kind===`hit`?.1:90/n,transform:`scale(1)`},{offset:1,transform:`scale(1)`}];d.animate(f,{delay:c,duration:n,easing:`linear`,fill:`both`});let p=t.kind===`lock`?a.firstElementChild:null;p&&typeof p.animate==`function`&&p.animate([{opacity:1,top:`-2px`},{opacity:1,top:`100%`}],{duration:o,easing:`linear`})},C=()=>{let t=l.parts,n=0;for(let r=0;r<v.length;r++){let i=v[r];if(!e.contains(i.spec.a)){i.cell&&i.cell.remove();continue}if(i.cell&&!i.cell.isConnected){if(u[i.spec.kind].life)continue;i.cell=void 0}if(v[n++]=i,!t)continue;if(!i.cell){let e=b(i.spec);i.cell=e.cell,i.skin=e.skin,i.tag=e.tag,i.slot=void 0,i.wide=void 0,t.shadow.appendChild(e.cell),S(i)}let a=x(i);i.spec.kind===`lock`&&_(a)}v.length=n,l.raf=n?i.requestAnimationFrame(C):void 0},w=()=>{l.raf&&=(i.cancelAnimationFrame(l.raf),void 0),C()},T=e=>v.push({spec:e}),E=(e,t,n,r)=>{for(let i=0;i<e.length;i++){let a=m(e[i]);if(a.width<1||a.height<1)continue;let o=e.length<=25&&a.width>=16&&a.height>=10;T({a:e[i],beat:n(i,a),kind:t,label:o?p(e[i]):void 0,life:r})}},D=()=>{l.mind&&=(i.clearInterval(l.mind),void 0)},O=e=>{for(let t=v.length-1;t>=0;t--)e(v[t].spec)&&(v[t].cell&&v[t].cell.remove(),v.splice(t,1))},k=()=>{if(!e.body)return[];let t=e.body.getElementsByTagName(`*`),n=new Set,r=[];for(let e=0;e<t.length&&r.length<160;e++){let a=t[e],o=a.tagName;if(o===`SCRIPT`||o===`STYLE`||o===`NOSCRIPT`||o===`TEMPLATE`||o===`OPTION`)continue;let s=!1;for(let e=a.firstChild;e;e=e.nextSibling)if(e.nodeType===3&&(e.nodeValue||``).trim()){s=!0;break}if(!s)continue;let c=a.parentElement,l=!1;for(;c;){if(n.has(c)){l=!0;break}c=c.parentElement}if(l)continue;n.add(a);let u=a.checkVisibility;if(typeof u==`function`&&!u.call(a,{opacityProperty:!0,visibilityProperty:!0}))continue;let d=m(a);d.width<16||d.height<6||d.left+d.width<=0||d.top+d.height<=0||d.left>=i.innerWidth||d.top>=i.innerHeight||r.push(a)}return r},A=i.__hermesWatchTag;l.tag!==A&&(l.tag=A,l.parts=void 0,D());let j=l.parts,M=t.aimed;if(n===`clear`||n===`rest`){if(D(),n===`rest`)return;t.aimed=null,O(e=>!!u[e.kind].life),j&&d(j.pointer,{opacity:`0`});return}if(n===`think`){l.pulse=()=>{let e=t.field&&t.field.length?t.field:t.nodes||[];if(!e.length||!l.parts||Math.random()<.55)return;let n=e[Math.floor(Math.random()*e.length)],r=m(n);r.width>=1&&r.height>=1&&(T({a:n,kind:`flash`,label:p(n),life:240+Math.random()*240}),w())},!l.mind&&!s&&(l.mind=i.setInterval(()=>{let e=l.pulse;e&&e()},260));return}if(n===`unpin`){O(e=>e.kind===`held`&&(!M||e.a===M)),t.aimed=null;return}let N=n===`sweep`||n===`hold`||n===`strobe`,P=t.field&&t.field.length?t.field:t.nodes||[],F=n===`read`?k():[];if(n===`read`?!F.length:N?!P.length:!M||!e.contains(M))return;let I=j&&j.host.isConnected?j:g();l.parts=I,I.nib.setAttribute(`fill`,c);try{I.host.hidePopover(),I.host.showPopover()}catch{}if(n===`pin`)O(e=>e.kind===`held`&&e.a===M),T({a:M,kind:`held`,label:r||p(M)}),t.aimed=null;else if(n===`hold`)O(e=>e.kind===`held`),E(P,`held`,()=>0),t.aimed=null;else if(n===`sweep`)O(e=>e.kind===`lock`),t.aimed=null,E(P,`candidate`,e=>{let t=Math.sin((e+1)*12.9898)*43758.5453;return(t-Math.floor(t))*900});else if(n===`read`)O(e=>e.kind===`lock`),t.aimed=null,E(F,`candidate`,(e,t)=>Math.max(0,Math.min(1,(t.top+t.height/2)/i.innerHeight))*1800,1400);else if(n===`strobe`){O(e=>e.kind===`lock`),t.aimed=null;let e=0,n=()=>{let t=Math.sin(++e*78.233)*43758.5453;return t-Math.floor(t)};if(s)E(P,`candidate`,()=>0);else for(let e=0;e<5e3;){let t=n()<.62?1:n()<.7?2:3;for(let r=0;r<t;r++){let t=P[Math.floor(n()*P.length)],r=m(t);r.width>=1&&r.height>=1&&T({a:t,beat:e,kind:`flash`,label:p(t),life:90+n()*200})}e+=n()<.85?26+n()*26*2:210+n()*210}}else n===`strike`?T({a:M,kind:`hit`}):(O(e=>e.kind===`lock`),T({a:M,kind:`lock`,label:p(M)}),d(I.pointer,{opacity:`1`}));w()}var y=3,b=36,x=7,S=12,C=240,w={x:0,y:0},T=!1;function E(){return T}var D=e=>new Promise(t=>setTimeout(t,e)),O=e=>1-(1-e)**3;async function k(e,t){let n=w;for(let r=1;r<=y;r++){let i=O(r/y);e.send({type:`mouseMove`,x:Math.round(n.x+(t.x-n.x)*i),y:Math.round(n.y+(t.y-n.y)*i)}),await D(b/y)}w=t,T=!0}async function A(e,t=1){for(let n=1;n<=t;n++)e.send({button:`left`,clickCount:n,type:`mouseDown`,x:w.x,y:w.y}),e.send({button:`left`,clickCount:n,type:`mouseUp`,x:w.x,y:w.y}),await D(x)}async function j(e,t){let n=0;for(let r=1;r<=S;r++){let i=Math.round(t*O(r/S)),a=i-n;n=i,a&&e.send({deltaX:0,deltaY:-a,type:`mouseWheel`,x:w.x,y:w.y}),await D(C/S)}}async function M(e,t){e.send({keyCode:t,type:`keyDown`}),e.send({keyCode:t,type:`char`}),e.send({keyCode:t,type:`keyUp`}),await D(x)}async function N(t){let n=e()?[`meta`]:[`control`];t.send({keyCode:`a`,modifiers:n,type:`keyDown`}),t.send({keyCode:`a`,modifiers:n,type:`keyUp`}),await D(x)}async function P(e,t){e.send({keyCode:t,type:`keyDown`}),e.send({keyCode:t,type:`keyUp`}),await D(x)}async function F(e,t){await P(e,`End`);for(let n=0;n<t;n++)await P(e,`Backspace`)}async function I(e,t,n){let r=0;for(let i of t)if(n?.aborted||(await M(e,i),r+=1,n?.aborted))return r;return r}var ee=[`back`,`forward`,`reload`],L=220,R=120,z=2,te=`The field kept refilling while it was being cleared, so nothing was typed — typing would only append to its old value. Click it again and retype, or set the value directly.`,B=e=>new Promise(t=>setTimeout(t,e)),V=8e3,H=[`click`,`hover`,`press`,`type`],U=[`click`,`type`],W=`No live page is open in the in-app browser — open one with open_preview first.`,G=`The page stopped answering right after — it is probably navigating. Call elements to see where you landed.`,K=(()=>{let e=v.toString(),t=5381;for(let n=0;n<e.length;n++)t=(t<<5)+t+e.charCodeAt(n)|0;return t})(),q=()=>`  var w = window;
  // Reassigned on every trip rather than cached behind a guard: the source is in
  // this payload either way, so the guard saved nothing and pinned a long-lived
  // tab to whichever build first touched it. The holder is the exception — it
  // carries the aimed element from the locate trip to the act trip.
  w.__hermesActHolder = w.__hermesActHolder || {};
  w.__hermesAct = ${_()};
  w.__hermesWatch_fn = (${v.toString()});
  w.__hermesWatchTag = ${K};
  var holder = w.__hermesActHolder;
  var act = function (a) { return w.__hermesAct(document, holder, a); };
  var watch = function (stage, label) {
    try { w.__hermesWatch_fn(document, holder, stage, label); } catch (err) {}
  };
  var wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  // Sit out a smooth scroll so the pointer is aimed at a target that has stopped
  // moving. A scroll that never started fires no scrollend, so only wait on one
  // we can actually see happening; capture catches nested scrollers, whose
  // scrollend does not bubble.
  var restAfterScroll = function () {
    return new Promise(function (resolve) {
      var sc = document.scrollingElement || document.documentElement;
      var x0 = sc ? sc.scrollLeft : 0;
      var y0 = sc ? sc.scrollTop : 0;
      requestAnimationFrame(function () {
        if (!sc || (sc.scrollLeft === x0 && sc.scrollTop === y0)) { return resolve(); }
        var done = false;
        var finish = function () {
          if (done) { return; }
          done = true;
          document.removeEventListener('scrollend', finish, true);
          clearTimeout(timer);
          resolve();
        };
        var timer = setTimeout(finish, 350);
        document.addEventListener('scrollend', finish, true);
      });
    });
  };`;function J(e,t){let n={focus:t,kind:`locate`,ref:e.ref,selector:e.selector};return`(function () {
${q()}
  var locate = ${JSON.stringify(n)};
  var found = act(locate);
  if (!found.success) { return Promise.resolve(JSON.stringify(found)); }
  watch('aim');
  // Arm a witness for the real input that is about to arrive. Without it a
  // click that never reached the page is indistinguishable from one the page
  // ignored, and the agent would report success either way.
  w.__hermesHit = null;
  document.addEventListener('pointerdown', function (e) {
    w.__hermesHit = { tag: e.target ? e.target.tagName : '?', trusted: e.isTrusted === true };
  }, { capture: true, once: true });
  // Measure again once the scroll has stopped: real input is aimed at a fixed
  // viewport coordinate, so it has to be where the target ENDS UP.
  return restAfterScroll().then(function () {
    var settled = act(locate);
    var best = settled.success ? settled : found;
    var at = best.point;
    // Last line of defence before the pointer is sent somewhere real. An element
    // that is still outside the viewport after we scrolled to it is hidden, not
    // placed, and aiming at it would drive the cursor off into a corner and
    // click whatever happens to be under that coordinate.
    if (at && (at.x < 0 || at.y < 0 || at.x > window.innerWidth || at.y > window.innerHeight)) {
      return JSON.stringify({
        error: 'That element is still off-screen after scrolling to it, so it is hidden rather than clickable. Call elements again for what is really on the page.',
        success: false
      });
    }
    return JSON.stringify(best);
  });
})()`}function Y(){return`(function () {
${q()}
  // hermes-focus-probe
  var aimed = holder.aimed;
  var active = document.activeElement;
  var tag = aimed && aimed.tagName ? aimed.tagName : '';
  var editable = !!(aimed && (aimed.isContentEditable === true || tag === 'INPUT' || tag === 'TEXTAREA'));
  var focused = editable && active === aimed;
  return Promise.resolve(JSON.stringify({
    focused: focused,
    success: true,
    tag: active && active.tagName ? active.tagName : ''
  }));
})()`}function X(e,t){let n={kind:`locate`,ref:e.ref,selector:e.selector};return`(function () {
${q()}
  var found = act(${JSON.stringify(n)});
  if (!found.success) { return JSON.stringify(found); }
  watch('pin', ${JSON.stringify(t)});
  return JSON.stringify({ acted: 'pinned ' + String(found.acted || 'it').replace(/^looking at /, ''), success: true });
})()`}function ne(){return`(function () {
${q()}
  var found = act({ kind: 'elements' });
  if (!found.success) { return JSON.stringify(found); }
  watch('hold');
  found.acted = 'held the field';
  return JSON.stringify(found);
})()`}function re(){return`(function () {
${q()}
  var found = act({ kind: 'elements' });
  if (!found.success) { return JSON.stringify(found); }
  watch('strobe');
  found.acted = 'strobed the field';
  return JSON.stringify(found);
})()`}function ie(e){let t={kind:`locate`,ref:e.ref,selector:e.selector},n=!!(e.ref||e.selector);return`(function () {
${q()}
${n?`  var found = act(${JSON.stringify(t)});
  if (!found.success) { return JSON.stringify(found); }
  var gone = 'unpinned ' + String(found.acted || 'it').replace(/^looking at /, '');`:`  holder.aimed = null;
  var gone = 'cleared every pin';`}
  watch('unpin');
  return JSON.stringify({ acted: gone, success: true });
})()`}function Z(e){return`(function () {
${q()}
  watch('strike');
  return wait(${e}).then(function () {
    // A rescan that throws must still answer — an unresolved promise here costs
    // the whole bridge deadline.
    try {
      var out = act({ kind: 'elements' });
      watch('sweep');
      out.hit = w.__hermesHit || null;
      return JSON.stringify(out);
    } catch (err) {
      return JSON.stringify({ note: 'The page changed before it could be re-read: ' + err, success: true });
    }
  });
})()`}function ae(e,t){return`(function () {
${q()}
  var result = act(${JSON.stringify(e)});
  ${e.kind===`elements`?`if (result.success) { watch('strobe'); }`:``}
  if (!result.success || ${t} <= 0) { return Promise.resolve(JSON.stringify(result)); }
  return wait(${t}).then(function () {
    try {
      var after = act({ kind: 'elements' });
      watch('sweep');
      // One or the other, never both: a re-read answers with the whole
      // inventory only when it is the first look at this page.
      result.elements = after.elements;
      result.delta = after.delta;
      result.url = after.url;
      result.title = after.title;
    } catch (err) {
      result.note = 'The page changed before it could be re-read: ' + err;
    }
    return JSON.stringify(result);
  });
})()`}function oe(){return`(function () {
    try {
      var el = document.activeElement;
      if (!el) { return JSON.stringify({ success: true, field: false, len: -1 }); }
      var value = '';
      var hasStart = false;
      try {
        if (el.value !== undefined) { value = String(el.value || ''); }
        else if (el.isContentEditable) { value = el.textContent || ''; }
      } catch (e) {}
      try { hasStart = typeof el.selectionStart === 'number'; } catch (e) {}
      return JSON.stringify({
        success: true,
        field: hasStart && value.length >= 0,
        len: value.length
      });
    } catch (err) {
      return JSON.stringify({ success: false });
    }
  })()`}async function se(e){let t=await Q(e,oe());if(t.kind!==`answered`||!t.result.success)return{ok:!1};let n=t.result;return n.field?{ok:!0,field:!0,len:n.len}:{ok:!0,field:!1}}async function ce(e,t,n,r){await B(R);for(let n=0;n<=z;n++){await N(t);let r=await se(e);if(!r.ok||!r.field||r.len===0)break;if(n===z)return{error:te,typed:0};await F(t,r.len)}return{typed:await I(t,n,r)}}function le(e){return`(function () {
    try {
      var el = document.activeElement;
      if (!el) { return JSON.stringify({ success: false, error: 'no focused field' }); }
      var setVal = null;
      if (el.tagName === 'TEXTAREA') { setVal = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; }
      else if (el.tagName === 'INPUT') { setVal = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; }
      if (setVal) { setVal.call(el, ${JSON.stringify(e)}); }
      else if ('value' in el) { el.value = ${JSON.stringify(e)}; }
      else if (el.isContentEditable) { el.textContent = ${JSON.stringify(e)}; }
      else { return JSON.stringify({ success: false, error: 'not a text field' }); }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return JSON.stringify({ success: true });
    } catch (err) {
      return JSON.stringify({ success: false, error: String(err) });
    }
  })()`}async function ue(e,t,n,r){let i=await ce(e,t,n,r);if(!i.error)return{typed:i.typed};let a=await Q(e,le(n));return a.kind===`answered`&&a.result.success?{typed:0}:{error:i.error,typed:0}}async function Q(e,t){let n=await Promise.race([e(`(async () => (${t}))()`).catch(e=>Error(String(e))),new Promise(e=>setTimeout(e,V))]);return n===void 0?{kind:`silent`}:n instanceof Error?{error:`The page rejected the action: `+n.message,kind:`failed`}:typeof n!=`string`||!n?{error:`The page did not answer the action.`,kind:`failed`}:{kind:`answered`,result:JSON.parse(n)}}function de(e){return e.length===1}function fe(e){let t=(e||``).toUpperCase();return!t||t===`BODY`||t===`HTML`}function $(e,t,n){return{error:`Typing stopped after ${t} of ${n} characters because the action ${e.reason===`timeout`?`timed out`:`was interrupted`}.`,success:!1}}function pe(e,t){return e.kind===`type`?`typed into `+t+(e.submit?` and submitted`:``):e.kind===`press`?`pressed `+(e.key||``)+` on `+t:e.kind===`hover`?`hovered over `+t:`clicked `+t}async function me(e,t,n,r){let i=await Q(e,J(n,n.kind===`press`));if(i.kind===`failed`)return{error:i.error,success:!1};if(i.kind===`silent`)return{acted:n.kind,note:G,success:!0};let a=i.result;if(!a.success)return a;if(!a.point)return{error:`Could not work out where that element is on screen.`,success:!1};if(await k(t,a.point),n.kind===`click`)await A(t);else if(n.kind===`type`){let i=n.text??``;if(a.typable===!1)return{error:`${String(a.acted||`That`).replace(/^looking at /,``)} is not a text field, so typing into it would only select the text under the pointer. Click it if it opens one, then type into that.`,success:!1};if(r?.aborted||(t.focus(),await A(t),r?.aborted))return $(r,0,i.length);let o=await Q(e,Y());if(o.kind!==`answered`||o.result.focused!==!0)return{error:`target is not focused (${o.kind===`answered`?String(o.result.tag||`the page`):`the page`}); nothing typed`,success:!1};if(r?.aborted)return $(r,0,i.length);let s=await ue(e,t,i,r);if(s.error)return{error:s.error,success:!1};if(r?.aborted)return $(r,s.typed,i.length);n.submit&&await M(t,`Enter`)}else if(n.kind===`press`){let e=n.key||`Enter`;if(de(e)&&n.allowShortcut!==!0&&fe(a.tag))return{error:`Refused to press a printable key on ${a.tag||`body`}. That would be a page shortcut; pass allowShortcut to opt in.`,success:!1};t.focus(),await M(t,e)}let o=String(a.acted||``).replace(/^looking at /,``),s=await Q(e,Z(L)),c=pe(n,o);if(s.kind!==`answered`)return{acted:c,note:G,success:!0};let{hit:l,...u}=s.result;return!l&&U.indexOf(n.kind)!==-1?{...u,error:`The pointer input never reached the page, so nothing was `+c.split(` `)[0]+`.`,success:!1}:{...u,acted:c,note:he(l),success:!0}}function he(e){return e&&e.tag===`HERMES-WATCH`?`The action overlay intercepted the click instead of the page.`:void 0}function ge(){return`(function () {
${q()}
  var sc = document.scrollingElement || document.documentElement;
  var track = sc.clientHeight || window.innerHeight;
  return Promise.resolve(JSON.stringify({
    page: Math.round(window.innerHeight * 0.9),
    point: { x: Math.round(window.innerWidth / 2), y: Math.round(track / 2) },
    span: sc.scrollHeight - track,
    success: true
  }));
})()`}async function _e(e,t,n){n.amount;let r=await Q(e,ge());if(r.kind===`failed`)return{error:r.error,success:!1};if(r.kind===`silent`)return{acted:`scrolled`,note:G,success:!0};let i=r.result;if(!i.span)return{...i,acted:`scrolled the page`,note:`The page has nothing to scroll — it all fits already.`};!E()&&i.point&&await k(t,i.point),await j(t,n.amount??i.page??600);let a=await Q(e,Z(L));return a.kind===`answered`?{...a.result,acted:`scrolled the page`,success:!0}:{acted:`scrolled the page`,note:G,success:!0}}async function ve(e,t,n){let i=ee.find(t=>t===e.kind);if(i){let e=d(n);return e?(e[i](),{acted:i,note:`Page is loading — call elements to see what is on it.`,success:!0}):{error:W,success:!1}}let a=r(n);if(!a)return{error:W,success:!1};let o=e;if(o.kind===`pin`||o.kind===`unpin`||o.kind===`hold`||o.kind===`strobe`){let e=await Q(a,o.kind===`hold`?ne():o.kind===`strobe`?re():o.kind===`pin`?X(o,o.text||``):ie(o));return e.kind===`failed`?{error:e.error,success:!1}:e.kind===`answered`?e.result:{acted:o.kind,note:G,success:!0}}let c=s(n);if(c&&H.indexOf(o.kind)!==-1)return me(a,c,o,t);if(o.kind===`scroll`&&!o.to&&!o.ref&&!o.selector&&c)return _e(a,c,o);let l=await Q(a,ae(o,o.kind===`elements`?0:L));return l.kind===`failed`?{error:l.error,success:!1}:l.kind===`silent`?{acted:o.kind,note:G,success:!0}:l.result}export{u as a,f as i,c as n,o,d as r,i as s,ve as t};