/* PA-CURRENCY-V2: shows CAD prices to visitors in Canada, USD to everyone else. A visitor's own pick (US or Canadian flag,
   in the header and the footer) wins; otherwise the country comes from their IP address (app.pomeroyagency.com/geo),
   with time zone and browser language as the fallback.
   Used by the app pricing page (web/pricing.html) and inlined into the Pomeroy Agency Wix embeds (marketing-site/build.py). */
(function(){
  if(window.__paCurrency)return;window.__paCurrency=1;
  // Approved CAD price points (about 1.42 CAD per USD, rounded). Keys are the USD figures as written on the site.
  var CAD={"4":"6","10":"14","12":"16.80","15":"21","20":"29","24":"36","25":"35","35":"49","49":"69","59":"85","99":"139","100":"140","129":"179","149":"209","150":"210","249":"349","250":"350","299":"419","350":"490","399":"569","490":"690","799":"1,129","1,290":"1,790","1,500":"2,100","2,490":"3,490","2,500":"3,500","3,000":"4,250","3,500":"4,950","3,990":"5,690","4,500":"6,300","6,000":"8,400","11,500":"16,050","15,000":"21,000"};
  var CA_TZ=/^America\/(Toronto|Montreal|Nipigon|Thunder_Bay|Rainy_River|Atikokan|Coral_Harbour|Iqaluit|Pangnirtung|Rankin_Inlet|Resolute|Cambridge_Bay|Winnipeg|Regina|Swift_Current|Edmonton|Yellowknife|Inuvik|Vancouver|Creston|Dawson_Creek|Fort_Nelson|Whitehorse|Dawson|Halifax|Glace_Bay|Moncton|Goose_Bay|St_Johns|Blanc-Sablon)$/;
  var PRICE=/(^|[^A-Za-z])(US)?\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g;
  var nodes=[];
  var KEY='pa-currency',GEO='https://app.pomeroyagency.com/geo';
  function chosen(){
    try{var q=new URLSearchParams(location.search).get('currency');if(q)return q.toLowerCase();}catch(e){}
    try{return localStorage.getItem(KEY);}catch(e){return null;}
  }
  function guess(){
    try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';if(CA_TZ.test(tz))return true;}catch(e){}
    var l=(navigator.language||'');return /-CA$/i.test(l);
  }
  // Small inline flags, so they look the same on every system (emoji flags show as letters on Windows).
  var US='<svg viewBox="0 0 26 14" width="26" height="14" aria-hidden="true"><rect width="26" height="14" fill="#fff"/>';
  for(var k=0;k<7;k++)US+='<rect y="'+(k*28/13).toFixed(2)+'" width="26" height="'+(14/13).toFixed(2)+'" fill="#B22234"/>';
  US+='<rect width="11" height="7.54" fill="#3C3B6E"/>';
  for(var r=0;r<3;r++)for(var c=0;c<4;c++)US+='<circle cx="'+(1.6+c*2.6)+'" cy="'+(1.5+r*2.3)+'" r=".5" fill="#fff"/>';
  US+='</svg>';
  var CA='<svg viewBox="0 0 26 14" width="26" height="14" aria-hidden="true"><rect width="26" height="14" fill="#fff"/><rect width="6.5" height="14" fill="#D80621"/><rect x="19.5" width="6.5" height="14" fill="#D80621"/><polygon fill="#D80621" points="13,2.2 13.8,3.8 14.8,3.3 14.5,5.4 15.9,4.4 15.6,5.4 16.6,5.7 15.1,7 15.4,7.7 13.3,7.4 13.3,9.6 12.7,9.6 12.7,7.4 10.6,7.7 10.9,7 9.4,5.7 10.4,5.4 10.1,4.4 11.5,5.4 11.2,3.3 12.2,3.8"/></svg>';
  function picker(cls,lead){
    var d=document.createElement('div');d.className='pa-cur '+cls;d.setAttribute('data-cur-skip','');d.setAttribute('role','group');d.setAttribute('aria-label','Currency');
    d.innerHTML=(lead?'<span class="pa-cur-lead">'+lead+'</span>':'')+
      '<button type="button" value="usd" title="Prices in US dollars">'+US+'<span>USA</span></button>'+
      '<button type="button" value="cad" title="Prices in Canadian dollars">'+CA+'<span>Canada</span></button>';
    d.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;picked=true;try{localStorage.setItem(KEY,b.value);}catch(x){}apply(b.value==='cad');});
    return d;
  }
  var picked=false;
  function collect(){
    var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),n;
    while((n=w.nextNode())){
      var p=n.parentNode;if(!p||/^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.nodeName)||p.closest('[data-cur-skip]'))continue;
      var t=n.nodeValue;PRICE.lastIndex=0;
      if(PRICE.test(t)||/US dollars/.test(t))nodes.push({n:n,usd:t,cad:null});
    }
    nodes.forEach(function(o){
      o.cad=o.usd.replace(PRICE,function(m,pre,us,num){return CAD[num]?pre+'C$'+CAD[num]:m;}).replace(/US dollars/g,'Canadian dollars');
    });
  }
  function apply(cad){
    nodes.forEach(function(o){o.n.nodeValue=cad?o.cad:o.usd;});
    document.documentElement.classList.toggle('pa-cad',cad);
    var bs=document.querySelectorAll('.pa-cur button');
    for(var i=0;i<bs.length;i++)bs[i].setAttribute('aria-pressed',String((bs[i].value==='cad')===cad));
  }
  function init(){
    collect();if(!nodes.length)return;
    var st=document.createElement('style');st.textContent=".pa-cur{display:inline-flex;align-items:flex-end;gap:8px;white-space:nowrap;font:500 9.5px/1.1 var(--mono,ui-monospace,monospace);letter-spacing:.06em}\n.pa-cur-head{margin-left:14px;color:rgba(255,255,255,.8)}\n.pa-cur-top{display:flex;justify-content:flex-end;margin:0;padding:6px 14px;background:#1f2a3a;color:rgba(255,255,255,.8)}\n.pa-cur-foot{display:flex;justify-content:center;margin:18px auto 0;font-size:10.5px;color:inherit}\n.pa-cur-lead{align-self:center;margin-right:2px}\n.pa-cur button{display:inline-flex;flex-direction:column;align-items:center;gap:3px;font:inherit;letter-spacing:inherit;background:none;border:0;padding:2px;color:inherit;cursor:pointer;opacity:.5}\n.pa-cur button svg{display:block;border-radius:2px;box-shadow:0 0 0 1px rgba(127,127,127,.4)}\n.pa-cur button[aria-pressed=\"true\"]{opacity:1;font-weight:700}\n.pa-cur button[aria-pressed=\"true\"] svg{box-shadow:0 0 0 2px currentColor}\n.pa-cur button:focus-visible{outline:2px solid currentColor;outline-offset:2px}\n.pa-ca-note{display:none}\nhtml.pa-cad .pa-ca-note{display:block}\n";document.head.appendChild(st);
    var row=document.querySelector('.site-header .nav-row');
    if(row)row.appendChild(picker('pa-cur-head'));else document.body.insertBefore(picker('pa-cur-top'),document.body.firstChild);
    var fs=document.querySelectorAll('.pa-footer, .site-footer, footer'),foot=fs[fs.length-1];
    var fp=picker('pa-cur-foot','Prices are all in:');
    if(foot)(foot.querySelector('.shell')||foot).appendChild(fp);else document.body.appendChild(fp);
    var c=chosen();
    if(c==='cad'||c==='usd'){apply(c==='cad');return;}
    apply(guess());
    // The visitor's IP address decides when it can be looked up; a pick made in the meantime wins.
    try{fetch(GEO,{cache:'no-store'}).then(function(r){return r.json();}).then(function(g){if(!picked&&g&&g.country)apply(g.country==='CA');}).catch(function(){});}catch(e){}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
