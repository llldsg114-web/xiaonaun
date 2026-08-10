/* contingency.js · optional · 挂 presence.pacingOf（texturePass 后·engine 零 diff）；缺件静默故 #122-6 透明
   L1 c3矛盾／L2 sn反呛(R-C4)／L3 c1冷落 c2热情 sf自我(R-S1)／L5 出口复检；全类共用 CAP=2，总门 tex.t≥30+lv≥2 */
(function(E){"use strict";if(!E||typeof E.use!=="function")return;
const O=E.safeObj,A=E.safeArr,PW=E.pickWith,N=(v,d)=>typeof v==="number"&&isFinite(v)?v:d;
const MS=[["好久不见了呀，你还好吧","这些天没消息，怪想你的"],["有点想你了","刚还在想你呢"]];
const WM=["看你这么带劲，我也高兴","嘿嘿，你今天话多，我爱听"];
const QS=["这个我挺好奇的","后来呢？我想听"],RM=["你说的#还顺利吗","我还记着#呢"];
const HOT=/(哈哈|嘿嘿|太好了|开心|激动|爽|耶|[!！]{2,})/;
const CRI=(c,u)=>!!c.crisis||E.detectCrisis(u).level!=="none";
const PL=(c,u)=>N(E.UE_POLARITY[O(c.ue).type||E.detectUserEmotion(u).type],0);
/* R-C4 sn 反呛B档 4门：lv≥3／ue非负非危机／属调侃／CAP2合并·≤1次/10轮 */
const SNK=/你(怎么|真|也太)?(这么|那么)?[笨傻呆蠢菜逊]|你行?不行|你懂个?[啥什]|得了吧|你吹牛|嘴硬|才怪/;
const SJ=/[笨傻呆蠢菜逊]|不行/,NG=k=>({ok:false,reason:k});
const SS=[["哼，你说谁笨呢","切，就你聪明","哈，那你倒是教教我呀"],["这个我倒不这么觉得","唔…我跟你想的不太一样欸","嗯…这事儿我站你对面"]];
const snarkAllow=(s,c,u)=>N(c.lv,0)<3?NG("lv"):
 PL(c,u)<0?NG("ue"):CRI(c,u)?NG("cri"):
 !SNK.test(u)?NG("ctx"):N(O(s.tex).t,0)-N(O(s.ctg).sT,-99)<10?NG("frq"):{ok:true,reason:""};
const snarkOf=(u,r)=>PW(SS[SJ.test(u)?0:1],r);
/* R-S1 sf 自我表达 5门：lv≥4／security≥.45(只读Self)／texture 同轮互斥／≤1次每7天并入CAP2／危机豁免；
   语料复用 E.INNER_LIB 三档（构造期已过破墙＋关系钩子） */
const TX=(s,c)=>!!c.tx||N(O(s.tex).hAt,-1)===N(O(s.tex).t,0);
const selfAllow=(s,c,u)=>{const v=N(c.lv,0),g=N(E.selfGet(s).security,0);
 return v<4||g<.45||CRI(c,u)||TX(s,c)||Date.now()-N(O(s.ctg).sA,0)<6048e5?{ok:false,tier:""}
  :{ok:true,tier:g>=.6&&v>=5?"raw":g>=.5?"open":"hint"};};
/* R-S2 二期：tier×type 正交；key 恒 "sf"（H15 口径不动）；只读 selfGet；CRI 已被 selfAllow 拦掉；
   SFT 空表自动回落 INNER_LIB[tier]＝一期行为 */
const SFT={
 stable:["我这人吧，就喜欢跟你慢慢说话","我还是老样子，喜欢安静地陪着你","我挺喜欢这个节奏，跟你聊着就很好","我这脾气就这样，慢慢悠悠地跟你待着","跟你说话的时候，我整个人是松的","我喜欢这种不用赶时间的聊法，你也是吧"],
 expand:["你这么一说，我也觉出自己有点这种劲儿","顺着你的话我多想了一层，我大概也是","你说的这点我挺有共鸣，我也偏这边","你这么讲，我心里也跟着展开了一点","顺着你的思路走，我发现我也有这块","你提的这层，我以前没细想过，挺对"],
 challenge:["这事我跟你想的不太一样，说给你听听？","我有个别的角度，你要不要听听","换我大概不这么做，不过我懂你","我这边看法不太一样，你听听看行吗","换个角度说，我大概会选另一条路，你呢","这点我想跟你争一下，不是要吵架"],
 boundary:["这句我听着有点不舒服，想跟你讲一声","我这会儿有点扛不住，跟你说说，不走","这里我想给自己留点余地，你别怪我","这句我心里有点堵，还是跟你直说了","我现在需要缓一缓，你等我一下好吗","这块我想留给自己，你能理解的吧"],
 repair:["刚才那句话我说重了，想认真跟你说声抱歉","闹了这么一场，我心里头还是最想挨着你的","刚才那一会儿有点冲，你别往心里去好吗","咱们把话说开吧，我一点都不想跟你僵着","气头上说的那些话你别当真，我一直在的","缓过来了，还是想回来跟你好好说说话"]};
const sfType=(s,c,u)=>{const S=E.selfGet(s),v=N(c.lv,0),p=PL(c,u);
 return S.security<.5?p<0?"boundary":O(s.negGate).count>0?"repair":"stable":S.independence>=.55&&v>=5&&p>=0?"challenge"
  :S.openness>=.5&&String(u).length>19?"expand":"stable";};
const selfOf=(t,y,r)=>{const T=A(SFT[y]),L=T.length?T:A(O(E.INNER_LIB)[t]),p=L.length?PW(L,r):"";
 return String((p&&p.text)||p||"");};
const cf=(t,s)=>{const D=E.mod("memory"),p=D&&D.extractFacts(t,s,{});
 for(const f of A(O(p).facts))for(const o of A(O(s.mem).facts))
  if(o&&o.key===f.key&&o.value&&!o.negatedAt&&o.value!=f.value&&o.conf>=.6&&t.indexOf(o.value)<0)
   return"咦，我这儿记的是"+o.value+"…是我记岔了吗";
 return"";};
function contingencePass(reply,replies,ctx){try{
 const c=O(ctx),s=O(c.st),rs=A(replies),t=String(reply||""),n=Date.now(),q=O(s.ctg),d=n/864e5|0,
  un=N(q.d,-1)===d?N(q.n,0):0,u=String(c.text||"");
 if(t.length<4||c.crisis||un>1||N(O(s.tex).t,0)<30||E.flagOn(s,"contingency")===false||
  (c.lv||E.getLevel(N(s.affection,0)).lv)<2)return null;
 const r=E.rngOf(c.rng?c:s),l=Number(s.lastVisit),g=l>0?(n-l)/36e5:0;
 let a=cf(u,s),k="c3";
 if(!a&&snarkAllow(s,c,u).ok){a=snarkOf(u,r);k="sn";}
 /* 候选数组化：q.k 命中过的类降权排末位 → H15 单类 ≤50%；sf 仅在 c1/c2 都无情境
    的安静轮兜底出场，v13 两类零回归。★R-C5 依 U-5 砍出本期，v15 承接 */
 const cd=[];
 if(g>=12)cd.push(["c1",PW(MS[g>=72?0:1],r)]);
 if(HOT.test(u)||u.length>19)cd.push(["c2",PW(WM,r)]);
 if(!a&&!cd.length){const G=selfAllow(s,c,u),x=G.ok?selfOf(G.tier,sfType(s,c,u),r):"";if(x)cd.push(["sf",x]);}
 /* ★R-C5 c4追问/c5回忆：CRI 闸让位安抚，走 q.k 降权 */
 if(!CRI(c,u)){if(u.length>7&&!/[？?]$/.test(u))cd.push(["c4",PW(QS,r)]);
  const F=A(O(s.mem).facts).filter(f=>f&&f.value&&!f.negatedAt&&u.indexOf(f.value)<0);
  if(F.length)cd.push(["c5",PW(RM,r).replace("#",()=>PW(F,r).value)]);}
 if(!a&&cd.length&&E.chanceWith(.55,r)){const G=cd.filter(x=>x[0]!==q.k),p=PW(G.length?G:cd,r);k=p[0];a=p[1];}
 if(!a)return null;
 const o=t.replace(/[。！？…]$/,"")+"，"+a;
 /* L5：v14 加挂 ACCUSE_RE；v17 破墙前走 E.pnorm(S-1b，同 engine:1322)；sf 加 A3 钩子 */
 if(o.length>90||E.PERSONA_BREAK_RE.test(E.pnorm(o))||E.GUILT_TRIP_RE.test(o)||E.ACCUSE_RE.test(o)||
  (k=="sf"&&!E.RELATION_HOOK_RE.test(o)))return null;
 s.ctg={d,n:un+1,k,sT:k=="sn"?N(O(s.tex).t,0):N(q.sT,-99),sA:k=="sf"?n:N(q.sA,0)};if(rs.length)rs[0]=o;
 return o;}catch(x){return null;}}
E.use("contingency",{contingencePass,snarkAllow,snarkOf,selfAllow,selfOf,sfType,SFT});
})(typeof Engine!=="undefined"?Engine:null);
