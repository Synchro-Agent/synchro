// TỆP SINH TỰ ĐỘNG bởi scripts/gen-chart-presets.mjs, đừng sửa tay: sửa app/design-engine/charts/echarts-presets.ts rồi chạy lại lệnh đó.
"use strict";
function sxChartOption(spec,tk){
spec=spec||{};tk=tk||{};
// Tên phông trong nháy kép làm hỏng thuộc tính style của SVG dựng ở máy chủ (SSR ghi thẳng vào thuộc tính): đổi sang nháy đơn.
var ink=tk.ink||"#1f2937",muted=tk.muted||"#6b7280",accent=tk.accent||"#2563eb",accent2=tk.accent2||"#0ea5e9",neutral=tk.neutral||"#94a3b8",line=tk.line||"#e5e7eb",pos=tk.pos||"#059669",neg=tk.neg||"#dc2626",bg=tk.bg||"#ffffff",font=(tk.font||"system-ui, sans-serif").replace(/"/g,"'");
var labels=(spec.labels||[]).map(String),series=(spec.series||[]).filter(function(s){return s&&s.data&&s.data.length}).slice(0,8),unit=spec.unit||"";
var hi=typeof spec.highlight==="number"?spec.highlight:series.map(function(s){return s.name}).indexOf(spec.highlight);
function pal(i,n){if(hi>=0)return i===hi?accent:neutral;return[accent,accent2,neutral,muted,line][i]||neutral}
function fmt(v){if(v===null||v===undefined||v==="")return"";var n=Number(v);if(!isFinite(n))return String(v);var s=Math.abs(n)>=1000?n.toLocaleString("vi-VN",{maximumFractionDigits:1}):String(Math.round(n*100)/100).replace(".",",");return s+unit}
var anim=tk.motion!==false;
var base={animation:anim,animationDuration:700,animationEasing:"cubicOut",animationDurationUpdate:400,backgroundColor:"transparent",
textStyle:{fontFamily:font,color:muted,fontSize:13},color:series.map(function(_,i){return pal(i)}),
tooltip:{trigger:"axis",backgroundColor:bg,borderColor:line,textStyle:{color:ink,fontFamily:font},axisPointer:{type:"none"},valueFormatter:fmt},
legend:{show:series.length>1,top:0,left:0,icon:"roundRect",itemWidth:10,itemHeight:10,textStyle:{color:muted,fontFamily:font}},
grid:{left:4,right:16,top:series.length>1?36:16,bottom:4,containLabel:true}};
function catAxis(){return{type:"category",data:labels,axisLine:{lineStyle:{color:line}},axisTick:{show:false},axisLabel:{color:muted,fontFamily:font,interval:labels.length<=12?0:"auto",hideOverlap:labels.length>12,overflow:"break"}}}
function valAxis(show){return{type:"value",show:!!show,splitLine:{show:!!show,lineStyle:{color:line,type:"dashed"}},axisLabel:{color:muted,formatter:fmt}}}
var t=spec.type;
if(t==="bar"){var hz=!!spec.horizontal;
return Object.assign(base,{xAxis:hz?valAxis(false):catAxis(),yAxis:hz?Object.assign(catAxis(),{inverse:true}):valAxis(false),
series:series.map(function(s,i){return{type:"bar",name:s.name,data:s.data,stack:spec.stacked?"all":undefined,barMaxWidth:48,barGap:"20%",itemStyle:{color:pal(i),borderRadius:spec.stacked?0:(hz?[0,4,4,0]:[4,4,0,0])},
label:{show:spec.stacked?i===series.length-1:series.length===1||i===(hi>=0?hi:0),position:hz?"right":"top",color:ink,fontWeight:600,formatter:function(p){return fmt(p.value)}}}})})}
if(t==="line"||t==="area"){var area=t==="area";
if(series.length<=3)base.grid.right=56;
return Object.assign(base,{xAxis:Object.assign(catAxis(),{boundaryGap:false}),yAxis:valAxis(true),
series:series.map(function(s,i){var c=pal(i);return{type:"line",name:s.name,data:s.data,stack:area&&spec.stacked?"all":undefined,symbol:"circle",symbolSize:6,showSymbol:s.data.length<=24,lineStyle:{width:i===hi||hi<0&&i===0?3:2,color:c},itemStyle:{color:c},
areaStyle:area?{color:{type:"linear",x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:c},{offset:1,color:"transparent"}]},opacity:.28}:undefined,
endLabel:{show:series.length<=3,color:c,fontWeight:600,formatter:function(p){return fmt(p.value)}},emphasis:{focus:"series"}}})})}
if(t==="pie"||t==="doughnut"){var s0=series[0]||{data:[]},cols=[accent,accent2,neutral,muted,line,pos];
return Object.assign(base,{color:cols,tooltip:{trigger:"item",backgroundColor:bg,borderColor:line,textStyle:{color:ink,fontFamily:font},valueFormatter:fmt},legend:{show:true,bottom:0,icon:"circle",itemWidth:8,itemHeight:8,textStyle:{color:muted,fontFamily:font}},
series:[{type:"pie",name:s0.name,radius:t==="doughnut"?["55%","78%"]:["0%","74%"],center:["50%","46%"],padAngle:t==="doughnut"?2:0,
itemStyle:{borderRadius:t==="doughnut"?8:0,borderColor:bg,borderWidth:t==="doughnut"?0:2},
label:{show:true,position:t==="doughnut"?"outside":"inside",color:t==="doughnut"?ink:"#fff",fontWeight:600,formatter:"{d}%"},labelLine:{length:8,length2:8,lineStyle:{color:line}},
data:labels.map(function(l,i){return{name:l,value:s0.data[i]}})}]})}
if(t==="waterfall"){
// Cột chồng: chuỗi nền trong suốt nâng cột tăng / giảm lên đúng mức tích lũy; total: cột đầu và cuối là tổng (cột đặc màu nhấn).
var d=(series[0]||{data:[]}).data.map(Number),baseV=[],up=[],down=[],tot=[],cum=0,n=d.length;
d.forEach(function(v,i){if(spec.total&&(i===0||i===n-1)){var tv=i===0?v:cum;baseV.push(0);tot.push(tv);up.push("-");down.push("-");if(i===0)cum=v;return}
baseV.push(v>=0?cum:cum+v);up.push(v>=0?v:"-");down.push(v<0?-v:"-");tot.push("-");cum+=v});
function wl(sign){return{show:true,position:"top",color:ink,fontWeight:600,formatter:function(p){return p.value==="-"?"":(sign<0?"−":sign>0?"+":"")+fmt(p.value)}}}
return Object.assign(base,{legend:{show:false},tooltip:{show:false},xAxis:catAxis(),yAxis:valAxis(false),
series:[{type:"bar",stack:"w",data:baseV,itemStyle:{color:"transparent"},emphasis:{disabled:true},silent:true,barMaxWidth:56},
{type:"bar",stack:"w",name:"+",data:up,itemStyle:{color:pos,borderRadius:[3,3,0,0]},label:wl(1),barMaxWidth:56},
{type:"bar",stack:"w",name:"−",data:down,itemStyle:{color:neg,borderRadius:[3,3,0,0]},label:wl(-1),barMaxWidth:56},
{type:"bar",stack:"w",name:"=",data:tot,itemStyle:{color:accent,borderRadius:[3,3,0,0]},label:wl(0),barMaxWidth:56}]})}
if(t==="sankey"){var nodes=(spec.nodes||[]).map(function(x,i){return{name:String(x.name),itemStyle:{color:[accent,accent2,neutral,muted,pos][i%5]}}});
return Object.assign(base,{legend:{show:false},tooltip:{trigger:"item",backgroundColor:bg,borderColor:line,textStyle:{color:ink,fontFamily:font},valueFormatter:fmt},
series:[{type:"sankey",left:4,right:96,top:8,bottom:8,nodeWidth:12,nodeGap:14,nodeAlign:"justify",draggable:false,emphasis:{focus:"adjacency"},
data:nodes,links:(spec.links||[]).map(function(l){return{source:String(l.source),target:String(l.target),value:Number(l.value)}}),
lineStyle:{color:"gradient",curveness:.5,opacity:.32},label:{color:ink,fontFamily:font,fontWeight:600,formatter:function(p){return p.name}},itemStyle:{borderWidth:0}}]})}
if(t==="radar"){var mx=0;series.forEach(function(s){s.data.forEach(function(v){mx=Math.max(mx,Number(v)||0)})});var top=Math.ceil(mx*1.12)||1;
return Object.assign(base,{tooltip:{trigger:"item",backgroundColor:bg,borderColor:line,textStyle:{color:ink,fontFamily:font}},legend:{show:series.length>1,bottom:0,icon:"roundRect",itemWidth:10,itemHeight:10,textStyle:{color:muted,fontFamily:font}},
radar:{indicator:labels.map(function(l){return{name:l,max:top}}),radius:"68%",center:["50%","50%"],splitNumber:4,axisName:{color:muted,fontFamily:font},splitLine:{lineStyle:{color:line}},splitArea:{show:false},axisLine:{lineStyle:{color:line}}},
series:[{type:"radar",symbol:"circle",symbolSize:5,data:series.map(function(s,i){var c=pal(i);return{name:s.name,value:s.data,lineStyle:{color:c,width:i===hi||hi<0&&i===0?2.5:1.5},itemStyle:{color:c},areaStyle:{color:c,opacity:i===hi||hi<0&&i===0?.18:.04}}})}]})}
return null}
var PRESETS = {
 "swiss-grid": {
  "bg": "#F4F4F0",
  "surface": "#FFFFFF",
  "ink": "#0F172A",
  "muted": "#475569",
  "accent": "#BF3100",
  "accent2": "#0F172A",
  "neutral": "#94A3B8",
  "line": "#CBD5E1",
  "pos": "#0F7B4F",
  "neg": "#B42318",
  "font": "\"Inter\",\"Noto Sans\",system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif"
 },
 "midnight-tech": {
  "bg": "#08090E",
  "surface": "#0F1015",
  "ink": "#F8FAFC",
  "muted": "#A3AEBF",
  "accent": "#818CF8",
  "accent2": "#38BDF8",
  "neutral": "#475569",
  "line": "#262A36",
  "pos": "#34D399",
  "neg": "#FB7185",
  "font": "\"Inter\",\"Noto Sans\",system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif"
 },
 "soft-bento": {
  "bg": "#F5F5F7",
  "surface": "#FFFFFF",
  "ink": "#1B1F2A",
  "muted": "#5A5F6E",
  "accent": "#0066CC",
  "accent2": "#0F7B4F",
  "neutral": "#B6B6BE",
  "line": "#E4E4E9",
  "pos": "#0F7B4F",
  "neg": "#B42318",
  "font": "\"Inter\",\"Noto Sans\",system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif"
 },
 "editorial-serif": {
  "bg": "#FAF7F2",
  "surface": "#FFFFFF",
  "ink": "#1C1917",
  "muted": "#6B645E",
  "accent": "#9A3412",
  "accent2": "#44403C",
  "neutral": "#BDB6AD",
  "line": "#E7E5E4",
  "pos": "#0F7B4F",
  "neg": "#B42318",
  "font": "\"Be Vietnam Pro\",\"Noto Sans\",system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif"
 },
 "exec-navy": {
  "bg": "#FFFFFF",
  "surface": "#F8FAFC",
  "ink": "#0A192F",
  "muted": "#475569",
  "accent": "#0052CC",
  "accent2": "#0369A1",
  "neutral": "#CBD5E1",
  "line": "#E2E8F0",
  "pos": "#0F7B4F",
  "neg": "#B42318",
  "font": "\"Inter\",\"Noto Sans\",system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif"
 },
 "neo-brutalist": {
  "bg": "#FFFDF5",
  "surface": "#FFFFFF",
  "ink": "#000000",
  "muted": "#27272A",
  "accent": "#7C3AED",
  "accent2": "#C2410C",
  "neutral": "#A1A1AA",
  "line": "#000000",
  "pos": "#0F7B4F",
  "neg": "#B42318",
  "font": "\"Be Vietnam Pro\",\"Noto Sans\",system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif"
 },
 "aurora-glass": {
  "bg": "#EEF2FF",
  "surface": "#FFFFFF",
  "ink": "#1E1B4B",
  "muted": "#4338CA",
  "accent": "#4F46E5",
  "accent2": "#BE185D",
  "neutral": "#B4BAE8",
  "line": "#D9DDF7",
  "pos": "#0F7B4F",
  "neg": "#B42318",
  "font": "\"Inter\",\"Noto Sans\",system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif"
 },
 "data-terminal": {
  "bg": "#0B0E14",
  "surface": "#111622",
  "ink": "#E2E8F0",
  "muted": "#9AA8BC",
  "accent": "#10B981",
  "accent2": "#F59E0B",
  "neutral": "#475569",
  "line": "#1E293B",
  "pos": "#34D399",
  "neg": "#FB7185",
  "font": "\"Inter\",\"Noto Sans\",system-ui,-apple-system,\"Segoe UI\",Roboto,Arial,sans-serif"
 }
};
module.exports = { sxChartOption: sxChartOption, PRESETS: PRESETS };
