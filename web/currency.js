/* PA-CURRENCY-V1: shows CAD prices to visitors in Canada (by time zone), USD to everyone else.
   Used by the app pricing page (web/pricing.html) and inlined into the Pomeroy Agency Wix embeds (marketing-site/build.py). */
(function(){
  if(window.__paCurrency)return;window.__paCurrency=1;
  // Approved CAD price points (about 1.42 CAD per USD, rounded). Keys are the USD figures as written on the site.
  var CAD={"4":"6","10":"14","12":"16.80","15":"21","20":"29","24":"36","25":"35","35":"49","49":"69","59":"85","99":"139","100":"140","129":"179","149":"209","150":"210","249":"349","250":"350","299":"419","350":"490","399":"569","490":"690","799":"1,129","1,290":"1,790","1,500":"2,100","2,490":"3,490","2,500":"3,500","3,000":"4,250","3,500":"4,950","3,990":"5,690","4,500":"6,300","6,000":"8,400","11,500":"16,050","15,000":"21,000"};
  var CA_TZ=/^America\/(Toronto|Montreal|Nipigon|Thunder_Bay|Rainy_River|Atikokan|Coral_Harbour|Iqaluit|Pangnirtung|Rankin_Inlet|Resolute|Cambridge_Bay|Winnipeg|Regina|Swift_Current|Edmonton|Yellowknife|Inuvik|Vancouver|Creston|Dawson_Creek|Fort_Nelson|Whitehorse|Dawson|Halifax|Glace_Bay|Moncton|Goose_Bay|St_Johns|Blanc-Sablon)$/;
  var PRICE=/(^|[^A-Za-z])(US)?\$(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/g;
  var nodes=[];
  function inCanada(){
    try{var q=new URLSearchParams(location.search).get('currency');if(q)return q.toLowerCase()==='cad';}catch(e){}
    try{var tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'';if(CA_TZ.test(tz))return true;}catch(e){}
    var l=(navigator.language||'');return /-CA$/i.test(l);
  }
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
    var st=document.createElement('style');st.textContent=".pa-cur{display:inline-flex;align-items:center;gap:3px;margin-left:14px;white-space:nowrap;font:500 11px/1.2 var(--mono,ui-monospace,monospace);letter-spacing:.06em;color:rgba(255,255,255,.7)}\n.pa-cur-top{display:flex;justify-content:flex-end;margin:0;padding:6px 14px;background:#1f2a3a}\n.pa-cur button{font:inherit;letter-spacing:inherit;background:none;border:0;padding:0 2px;color:inherit;cursor:pointer;opacity:.6}\n.pa-cur button[aria-pressed=\"true\"]{opacity:1;font-weight:700;text-decoration:underline}\n.pa-ca-note{display:none}\nhtml.pa-cad .pa-ca-note{display:block}\n";document.head.appendChild(st);
    var bar=document.createElement('div');bar.className='pa-cur';bar.setAttribute('data-cur-skip','');
    bar.innerHTML='Prices in <button type="button" value="usd">USD</button> / <button type="button" value="cad">CAD</button>';
    bar.addEventListener('click',function(e){if(e.target.value)apply(e.target.value==='cad');});
    var row=document.querySelector('.site-header .nav-row');
    if(row)row.appendChild(bar);else{bar.className+=' pa-cur-top';document.body.insertBefore(bar,document.body.firstChild);}
    apply(inCanada());
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
