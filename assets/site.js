/* MUNIMO site.js — shared interactions. Vanilla, transform/opacity only, rAF-driven. */
'use strict';
(function(){
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ─── reveal on scroll ─── */
const io=new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target);} }),{threshold:.12,rootMargin:'0px 0px -8% 0px'});
$$('.rv').forEach(el=>io.observe(el));

/* ─── mobile sticky bar appears after 1.2 screens ─── */
const mbar=$('.mbar');
if(mbar){ addEventListener('scroll',()=>{ mbar.classList.toggle('show', scrollY>innerHeight*1.15); },{passive:true}); }

/* ─── hero phone: scroll-driven 3D rise (signature beat #1) ─── */
const hero=$('[data-hero-phone]');
if(hero && !reduced){
  let tick=false;
  const upd=()=>{ tick=false;
    const r=hero.parentElement.getBoundingClientRect();
    const p=Math.min(1,Math.max(0, 1 - (r.top+r.height*.55)/innerHeight ));
    const rx=(1-p)*16, ty=(1-p)*46;
    hero.style.transform=`rotateX(${rx}deg) translateY(${ty}px)`;
  };
  addEventListener('scroll',()=>{ if(!tick){tick=true;requestAnimationFrame(upd);} },{passive:true});
  upd();
}

/* ─── live demo iframes: activate on first touch (perf) ─── */
$$('[data-demo]').forEach(w=>{
  const src=w.dataset.demo, ov=w.querySelector('.demo-ov');
  const boot=()=>{ if(w.dataset.on)return; w.dataset.on=1;
    const f=document.createElement('iframe'); f.src=src; f.loading='lazy'; f.title='Munimo live demo';
    w.appendChild(f); if(ov) ov.classList.add('gone');
  };
  if(matchMedia('(min-width:880px)').matches){
    new IntersectionObserver((es,o)=>{ if(es[0].isIntersecting){boot();o.disconnect();} },{rootMargin:'200px'}).observe(w);
  }
  if(ov) ov.addEventListener('click',boot,{once:true});
});

/* ─── screenshot theatre ─── */
$$('[data-theatre]').forEach(th=>{
  const shots=[...th.querySelectorAll('.shot')], dots=[...th.querySelectorAll('.tdot')];
  const cap=th.querySelector('.tc-txt'), sub=th.querySelector('.tc-sub');
  let i=0,t;
  const go=n=>{ i=(n+shots.length)%shots.length;
    shots.forEach((s,k)=>s.classList.toggle('on',k===i));
    dots.forEach((d,k)=>d.classList.toggle('on',k===i));
    const s=shots[i]; if(cap)cap.textContent=s.dataset.cap||''; if(sub)sub.textContent=s.dataset.sub||'';
    clearTimeout(t); t=setTimeout(()=>go(i+1), reduced?12000:7000);
  };
  dots.forEach((d,k)=>d.addEventListener('click',()=>go(k)));
  th.querySelectorAll('[data-next]').forEach(b=>b.addEventListener('click',()=>go(i+1)));
  new IntersectionObserver((es,o)=>{ if(es[0].isIntersecting){go(0);o.disconnect();} },{threshold:.25}).observe(th);
});

/* ─── theatre tab groups (switch persona) ─── */
$$('[data-ttabs]').forEach(group=>{
  const tabs=[...group.querySelectorAll('.ttab')];
  tabs.forEach(tab=>tab.addEventListener('click',()=>{
    tabs.forEach(x=>x.classList.remove('on')); tab.classList.add('on');
    const tgt=tab.dataset.show;
    $$(tab.dataset.pool).forEach(p=>p.style.display = p.id===tgt?'':'none');
  }));
});

/* ─── self-writing multilingual ledger (AI showcase) ─── */
$$('[data-ai]').forEach(box=>{
  const SCRIPTS={
    en:{chip:'English', text:'Paid diesel 3,200 for JCB and got 50,000 from Borah Builders',
        rows:[['Diesel — JCB','Expense ▸ Machinery','−₹3,200'],['Borah Builders','Receivable ▸ Payment','+₹50,000']]},
    hi:{chip:'हिन्दी', text:'आज मज़दूरी ₹4,500 दी और सीमेंट ₹12,000 का आया',
        rows:[['मज़दूरी — 12 लोग','Labour ▸ Wages','−₹4,500'],['सीमेंट — 40 बैग','Purchase ▸ Material','−₹12,000']]},
    mr:{chip:'मराठी', text:'आज मजुरी ₹4,500 दिली आणि सिमेंट ₹12,000 चा आला',
        rows:[['मजुरी — 12 माणसं','Labour ▸ Wages','−₹4,500'],['सिमेंट — 40 बॅग','Purchase ▸ Material','−₹12,000']]},
    ta:{chip:'தமிழ்', text:'இன்று கடை வாடகை ₹8,000 கட்டினேன்',
        rows:[['கடை வாடகை — ஜூலை','Expense ▸ Rent','−₹8,000']]},
    te:{chip:'తెలుగు', text:'ఈ రోజు కూలీ ₹4,500 ఇచ్చాను',
        rows:[['కూలీ — 12 మంది','Labour ▸ Wages','−₹4,500']]},
    gu:{chip:'ગુજરાતી', text:'રમેશભાઈ પાસેથી ₹15,000 ઉધારી આવી',
        rows:[['રમેશભાઈ — ઉધાર વસૂલી','Receivable ▸ Collection','+₹15,000']]},
    bn:{chip:'বাংলা', text:'আজ স্কুল ফি ₹22,500 জমা হয়েছে',
        rows:[['স্কুল ফি — ক্লাস ৫','Income ▸ Fees','+₹22,500']]}
  };
  const chipwrap=box.querySelector('.langchips'), bub=box.querySelector('.bubble-u'), entry=box.querySelector('.ai-entry'), rowsEl=box.querySelector('.ae-rows');
  let cur='hi', timer=null, started=false;
  Object.entries(SCRIPTS).forEach(([k,v],idx)=>{
    const c=document.createElement('button'); c.className='lchip'+(idx===0?' on':''); c.textContent=v.chip;
    c.onclick=()=>{ cur=k; chipwrap.querySelectorAll('.lchip').forEach(x=>x.classList.remove('on')); c.classList.add('on'); play(); };
    chipwrap.appendChild(c);
  });
  function play(){
    clearInterval(timer); entry.classList.remove('in');
    const s=SCRIPTS[cur]; const chars=[...s.text]; let n=0;
    bub.innerHTML='<span class="typed"></span><span class="caret"></span>';
    const typed=bub.querySelector('.typed');
    timer=setInterval(()=>{
      n++; typed.textContent=chars.slice(0,n).join('');
      if(n>=chars.length){ clearInterval(timer);
        setTimeout(()=>{
          rowsEl.innerHTML=s.rows.map(r=>`<div class="ae-row"><div>${r[0]}<span class="cat">${r[1]}</span></div><div class="amt num" style="color:${r[2][0]==='+'?'var(--em2)':'var(--red)'}">${r[2]}</div></div>`).join('');
          entry.classList.add('in');
          timer=setTimeout(()=>{ const ks=Object.keys(SCRIPTS); cur=ks[(ks.indexOf(cur)+1)%ks.length];
            chipwrap.querySelectorAll('.lchip').forEach((x,i2)=>x.classList.toggle('on',Object.keys(SCRIPTS)[i2]===cur)); play(); }, 5200);
        }, 420);
      }
    }, reduced?8:38);
  }
  new IntersectionObserver((es,o)=>{ if(es[0].isIntersecting && !started){ started=true; play(); o.disconnect(); } },{threshold:.35}).observe(box);
});

/* ─── 3D language flip word ─── */
$$('[data-flip]').forEach(el=>{
  const words=el.dataset.flip.split('|');
  let i=0; el.textContent=words[0];
  el.style.display='inline-block'; el.style.transformStyle='preserve-3d';
  if(reduced) return;
  setInterval(()=>{
    el.style.transition='transform .28s ease-in, opacity .28s'; el.style.transform='rotateX(88deg) translateY(-6px)'; el.style.opacity='0';
    setTimeout(()=>{ i=(i+1)%words.length; el.textContent=words[i];
      el.style.transition='none'; el.style.transform='rotateX(-88deg) translateY(6px)';
      requestAnimationFrame(()=>requestAnimationFrame(()=>{ el.style.transition='transform .32s cubic-bezier(.22,1,.36,1), opacity .32s'; el.style.transform='rotateX(0)'; el.style.opacity='1'; }));
    },290);
  },2600);
});

/* ─── number tickers ─── */
$$('[data-count]').forEach(el=>{
  const end=parseFloat(el.dataset.count), pre=el.dataset.pre||'', suf=el.dataset.suf||'';
  new IntersectionObserver((es,o)=>{ if(!es[0].isIntersecting) return; o.disconnect();
    if(reduced){ el.textContent=pre+end.toLocaleString('en-IN')+suf; return; }
    const t0=performance.now(), dur=1400;
    const step=t=>{ const p=Math.min(1,(t-t0)/dur), v=Math.round(end*(1-Math.pow(1-p,3)));
      el.textContent=pre+v.toLocaleString('en-IN')+suf; if(p<1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  },{threshold:.5}).observe(el);
});

/* ─── budget slider → WhatsApp prefill ─── */
const bs=$('#budget-range');
if(bs){
  const out=$('#budget-val'), desc=$('#budget-desc'), wa=$('#budget-wa');
  const TIERS=[
    [15000,'Munimo Khata + Lite — for your whole team, setup included'],
    [40000,'Munimo Lite full setup + custom reports built for you'],
    [90000,'ConstructPro core — billing, GST, labour, site P&L'],
    [200000,'Full ConstructPro ERP — all modules, AI bookkeeper, training'],
    [500000,'Custom ERP — built for your business from scratch']
  ];
  const upd=()=>{
    const v=+bs.value; bs.style.setProperty('--fill',((v-bs.min)/(bs.max-bs.min)*100)+'%');
    out.textContent='₹'+(+v).toLocaleString('en-IN');
    const t=TIERS.find(t=>v<=t[0])||TIERS[TIERS.length-1];
    desc.textContent=t[1];
    wa.href='https://wa.me/919599942248?text='+encodeURIComponent(`Hi Munimo! My budget is ₹${(+v).toLocaleString('en-IN')}. What can you build for my business? Business: ____ City: ____`);
  };
  bs.addEventListener('input',upd); upd();
}
})();
