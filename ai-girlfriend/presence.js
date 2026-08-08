/* v13 presence.js · T3 · 契约§2.4 · R31四态/R32节奏/R33补偿 (presenceOf+pacingOf 由 engine 包 try/catch) */
(function(E){"use strict";if(!E||typeof E.use!=="function")return;
const O=E.safeObj,A=E.safeArr,M=Math,CW=E.chanceWith;
const N=(v,d)=>typeof v==="number"&&isFinite(v)?v:d;
const H=36e5,BZ=54e5,AY=72e4,CAP=10*H,BLK=8*H;
const R=(s,u,r,i)=>({state:s,until:u,reason:r,traceIdx:i});
const AW=r=>R("awake",0,r,-1);
const RN=(c,s)=>E.rngOf(typeof O(c).rng==="function"?c:O(s));
const PG=s=>{const n=parseInt(E.hashStr(String(s)),36);return((n>>>0)%1e6)/1e6;};
const CR=t=>E.detectCrisis(String(t||"")).level!=="none";
const NO=s=>E.flagOn(O(s),"presence")===false;
const P=s=>O(O(s).pres);
const DI=n=>E.dayIndex(E.dayKey(new Date(n)));
const sleepWindow=(state,day)=>{const s=O(state),lo=N(O(s.moodDay).energy,.6)<.35;const f=(25-(lo?1:0)+(O(s.persona).tone==="playful"?.5:0)+15*E.dayNoise(String(N(day,DI(Date.now()))),"slp"))%24;return{from:f,to:(f+7+(lo?.5:0))%24};};
const unavailAllow=(state,ctx)=>{const s=O(state),c=O(ctx),p=P(s),d=DI(N(c.now,Date.now()));if(NO(s)||CR(c.text)||N(p.n,0)>1)return false;return(N(p.d,-1)===d?N(p.a,0):0)<CAP&&N(p.bd,-2)!==d-1;};
const presenceOf=(state,ctx)=>{const s=O(state),c=O(ctx),now=N(c.now,Date.now()),p=P(s);if(NO(s))return AW("off");if(CR(c.text))return AW("crisis");if(!unavailAllow(s,{now,text:c.text}))return AW("ok");const d=DI(now),u=N(p.d,-1)===d?N(p.a,0):0,t=new Date(now),h=t.getHours()+t.getMinutes()/60,w=sleepWindow(s,d),g=()=>PG(c.text+"|"+E.dayKey(t)+"|"+d);if(w.from<=w.to?(h>=w.from&&h<w.to):(h>=w.from||h<w.to)){const L=M.min(((w.to-h+24)%24)*H,CAP-u);if(L>6e5)return R("asleep",now+L,"sleep",-1);}const tr=A(O(s.dayLife).traces),i=tr.length-1,x=O(tr[i]);if(i>=0&&x.date===E.dayKey(t)&&u+BZ<=CAP&&CW(.12,g))return R("busy",now+BZ,String(x.text||"busy"),i);return(u+AY<=CAP&&CW(.08,g))?R("away",now+AY,"away",-1):AW("ok");};
/* T5b 挂载点：engine:3057 是 texturePass 之后唯一拿得到 replies 的模块入口；缺件即跳过，依赖不破 */
const pacingOf=(userText,reply,ctx)=>{const c=O(ctx),s=O(c.st),rs=A(reply),ut=String(userText||"");
const G=E.mod("contingency");if(G)try{G.contingencePass(rs[0],rs,{st:s,ue:c.ue,lv:c.lv,crisis:!!c.crisis||CR(ut),text:ut,rng:RN(c,s),tx:c.tx});}catch(e){}
const L=rs.join("").length;if(NO(s)||!L)return null;if(c.crisis||CR(ut))return{delayMs:200,typingMs:300,split:false};const ar=N(E.UE_AROUSAL[O(c.ue).type],0),en=N(O(s.moodDay).energy,.6);const ms=(M.min(2200,90*ut.length)+(ar>.3?260:620)+L*(105-30*ar)*(1.35-.55*en))*(.45+1.45*RN(c,s)());return{delayMs:M.round(M.max(320,M.min(7800,ms))),typingMs:M.round(M.min(6e3,L*80)),split:rs.length>1||(L>34&&ar>.3)};};
const MK=["刚睡醒…这会儿才看到你消息","刚忙完，一空下来就来找你了"];
const makeupLine=(state,ctx)=>{const s=O(state),p=P(s),q=N(p.q,0);if(!q||NO(s))return null;const t=String(MK[q-1]||"");return(!t||E.GUILT_TRIP_RE.test(t)||E.PERSONA_BREAK_RE.test(E.pnorm(t)))?null:{text:t,motive:"makeup"};};
const presenceAfterTurn=(state,p)=>{const s=O(state),r=O(p),now=N(r.now,Date.now()),c=P(s),d=DI(now),fr=N(c.d,-1)===d,k=r.state||"awake",o=k!=="awake";const a=M.min(CAP,(fr?N(c.a,0):0)+M.max(0,M.min(now,N(c.u,0))-N(c.la,now)));s.pres={d,a,la:now,s:k,u:o?N(r.until,0):0,r:String(r.reason||""),n:o?(fr?N(c.n,0):0)+1:0,bd:a>=BLK?d:N(c.bd,-2),q:o?(k==="asleep"?1:2):(r.consumed?0:N(c.q,0))};return s.pres;};
E.use("presence",{presenceOf,sleepWindow,pacingOf,unavailAllow,makeupLine,presenceAfterTurn});
})(typeof Engine!=="undefined"?Engine:null);
