"use strict";
// AlphaOS Renderer — A2G Font + Canvas Menu Bar

// ─── Register A2G font with canvas ────────────────────────────────────────────
(function(){
    if(typeof FontFace==="undefined")return;
    // Fira Code for terminal
    const fc=new FontFace("FiraCode","url(fonts/FiraCode-Medium.ttf) format('truetype')",{weight:"500"});
    fc.load().then(loaded=>{document.fonts.add(loaded);}).catch(()=>{});
    // A2G for UI
    const files=[
        {w:100,f:"A2G-Thin"},{w:200,f:"A2G-ExtraLight"},{w:300,f:"A2G-Light"},
        {w:400,f:"A2G-Regular"},{w:500,f:"A2G-Medium"},{w:600,f:"A2G-SemiBold"},
        {w:700,f:"A2G-Bold"},{w:800,f:"A2G-ExtraBold"},{w:900,f:"A2G-Black"},
    ];
    files.forEach(({w,f})=>{
        const ff=new FontFace("A2G",`url(fonts/${f}.otf) format('opentype')`,{weight:String(w)});
        ff.load().then(loaded=>{document.fonts.add(loaded);}).catch(()=>{});
    });
})();
const canvasWrap = document.getElementById("canvas-wrap");
const screen     = document.getElementById("screen");
const ctx        = screen.getContext("2d", { alpha: false });
let displayW = 1280, displayH = 720;
function resizeCanvas(w,h){displayW=w;displayH=h;screen.width=w;screen.height=h;}
resizeCanvas(displayW,displayH);
let cMouseX=0, cMouseY=0;
function updateMouse(e){
    const r=canvasWrap.getBoundingClientRect();
    cMouseX=(e.clientX-r.left)*(displayW/r.width);
    cMouseY=(e.clientY-r.top)*(displayH/r.height);
}

// ─── Font constants ───────────────────────────────────────────────────────────
const FONT_UI   = "'A2G', system-ui, sans-serif";
const FONT_MONO = "'A2G', 'Courier New', monospace";
// Helper: build canvas font string using A2G
function F(size, weight){ return `${weight||400} ${size}px ${FONT_UI}`; }
function FM(size){ return `400 ${size}px ${FONT_MONO}`; }

// ─── Theme system ─────────────────────────────────────────────────────────────
let currentTheme = "light";
const THEMES = {
    light: {
        bg:"#ffffff", surface:"#fafafa", border:"#e4e4e7", border2:"#d4d4d8",
        muted:"#f4f4f5", text:"#09090b", text2:"#3f3f46", text3:"#a1a1aa",
        winBg:"#ffffff", titleBar:"#fafafa", borderFoc:"#c4c4c4", borderBlr:"#e8e8e8",
        shadow:"rgba(0,0,0,0.06)", shadowFoc:"rgba(0,0,0,0.10)",
        btnClose:"#ef4444", btnMin:"#f59e0b", btnMax:"#22c55e",
        blue:"#3b82f6", dockBg:"rgba(250,250,250,0.88)", dockBorder:"rgba(228,228,231,0.8)",
        deskBg:"#eef0f3", deskGrid:"rgba(0,0,0,0.03)",
        menuBar:"rgba(245,245,247,0.92)", menuBarText:"#1d1d1f", menuBarBorder:"rgba(0,0,0,0.1)",
    },
    dark: {
        bg:"#09090b", surface:"#18181b", border:"#27272a", border2:"#3f3f46",
        muted:"#1c1c1e", text:"#f4f4f5", text2:"#d4d4d8", text3:"#71717a",
        winBg:"#18181b", titleBar:"#141414", borderFoc:"#52525b", borderBlr:"#27272a",
        shadow:"rgba(0,0,0,0.4)", shadowFoc:"rgba(0,0,0,0.6)",
        btnClose:"#ef4444", btnMin:"#f59e0b", btnMax:"#22c55e",
        blue:"#3b82f6", dockBg:"rgba(24,24,27,0.88)", dockBorder:"rgba(63,63,70,0.6)",
        deskBg:"#0f0f11", deskGrid:"rgba(255,255,255,0.02)",
        menuBar:"rgba(28,28,30,0.92)", menuBarText:"#f0f0f5", menuBarBorder:"rgba(255,255,255,0.08)",
    },
};
let L = {...THEMES.light};

// Wallpapers: gradient definitions
const WALLPAPERS = [
    { id:"default",  label:"Default",   bg:"#eef0f3", dark:"#0f0f11" },
    { id:"blue",     label:"Blue",      bg:"linear-gradient(135deg,#dbeafe,#e0e7ff)", dark:"linear-gradient(135deg,#1e3a5f,#1e1b4b)" },
    { id:"green",    label:"Green",     bg:"linear-gradient(135deg,#dcfce7,#d1fae5)", dark:"linear-gradient(135deg,#14532d,#064e3b)" },
    { id:"purple",   label:"Purple",    bg:"linear-gradient(135deg,#f3e8ff,#fce7f3)", dark:"linear-gradient(135deg,#3b0764,#4a044e)" },
    { id:"warm",     label:"Warm",      bg:"linear-gradient(135deg,#fef9c3,#ffedd5)", dark:"linear-gradient(135deg,#713f12,#7c2d12)" },
];
let currentWallpaper = "default";

function applyTheme(name){ currentTheme=name; L={...THEMES[name]}; }
function applyWallpaper(id){ currentWallpaper=id; }

// ─── Top Menu Bar constants ────────────────────────────────────────────────────
const MENU_BAR_H = 26;
// Menu state
let menuBarOpen = null; // null | "apple" | "file"
let menuBarItems = null; // current dropdown items

// (palette now managed by THEMES — see let L above)

// ─── Chrome geometry ──────────────────────────────────────────────────────────
const TITLE_H    = 36;
const BORDER     = 1;
const RESIZE_HIT = 6;
const BTN_R      = 5.5;
const BTN_PAD    = 14;
const BTN_GAP    = 18;

// ─── Dock ─────────────────────────────────────────────────────────────────────
const D_BASE  = 44;
const D_MAX   = 68;
const D_PAD   = 9;
const D_VPAD  = 9;
const D_BOT   = 8;
const D_PUSH  = 0.32;
const D_MAG_R = 80;

// ─── State ────────────────────────────────────────────────────────────────────
let windows=[], focusedId=null, booted=false;
let drag=null, resize=null, ctxMenu=null;
// ─── InputField mouse helpers ─────────────────────────────────────────────────
// Measure character index from pixel offset using canvas measureText
function _xToCharIdx(text, px, font){
    const f=font||"12px 'A2G',system-ui";
    const prev=ctx.font;
    ctx.font=f;
    // Binary search for closest character boundary
    let lo=0,hi=text.length,best=0,bestDist=Infinity;
    for(let i=0;i<=text.length;i++){
        const w=ctx.measureText(text.slice(0,i)).width;
        const d=Math.abs(px-w);
        if(d<bestDist){bestDist=d;best=i;}
    }
    ctx.font=prev;
    return best;
}

// ─── Launcher Overlay (All Apps) ─────────────────────────────────────────────
let launcherOpen = false;
let launcherQuery = "";
let launcherField = { value:"", cursor:0, selStart:null, blink: Date.now() };
const LAUNCHER_APPS = [
    { id:"terminal", icon:"💻", label:"Terminal",      color:"#18181b" },
    { id:"files",    icon:"📁", label:"File Explorer", color:"#f59e0b" },
    { id:"settings", icon:"⚙️",  label:"Settings",      color:"#6366f1" },
    { id:"newfile",  icon:"📝", label:"Text Editor",   color:"#3b82f6" },
    { id:"sysinfo",  icon:"ℹ️",  label:"System Info",   color:"#0ea5e9" },
];

// Helper: send dock_app_click, but intercept 'allapps' to open launcher
function sendAppEvent(appId){
    if(appId==="allapps"){
        launcherOpen=true;
        launcherField={value:"",cursor:0,selStart:null,blink:Date.now(),_lastClick:0,_lastClickPos:-1};
        return;
    }
    window.alphaOS.sendEvent({type:"dock_app_click",appId});
}
// Unified drag state for desktop files and FE entries
// kind: 'desktop'|'fe'
// srcWinId: FE window id (for fe kind), or -1 (desktop)
// entryIdx: row index in FE, or desktop file idx
// label: display name
// srcPath: full vfs path being moved
// active: true once threshold crossed
let unifiedDrag=null;
const offscreens=new Map();

// ─── Boot ─────────────────────────────────────────────────────────────────────
const splash=document.getElementById("boot-splash");
const bootMsg=document.getElementById("boot-msg");
const bootBar=document.getElementById("boot-bar");
const BSTEPS=["Memory...","VFS...","Drivers...","Window manager...","PID 1...","Ready."];
let bStep=0;
const bTimer=setInterval(()=>{
    if(booted){clearInterval(bTimer);return;}
    if(bStep<BSTEPS.length){bootMsg.textContent=BSTEPS[bStep];bootBar.style.width=`${Math.round((bStep+1)/BSTEPS.length*100)}%`;bStep++;}
},300);

// ─── Log ─────────────────────────────────────────────────────────────────────
const logScroll=document.getElementById("log-scroll");
let logFilter="all";
function appendLog(level,msg){
    if(logFilter!=="all"&&logFilter!==level)return;
    const d=document.createElement("div");d.className="log-line";
    const now=new Date();
    const ts=[now.getHours(),now.getMinutes(),now.getSeconds()].map(n=>String(n).padStart(2,"0")).join(":");
    d.innerHTML=`<span class="log-ts">${ts}</span><span class="log-lvl ${level}">${level}</span><span class="log-msg">${String(msg).replace(/</g,"&lt;")}</span>`;
    logScroll.appendChild(d);
    while(logScroll.children.length>400)logScroll.removeChild(logScroll.firstChild);
    logScroll.scrollTop=logScroll.scrollHeight;
}
document.querySelectorAll(".log-filter-btn[data-level]").forEach(btn=>{
    btn.addEventListener("click",()=>{
        document.querySelectorAll(".log-filter-btn[data-level]").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active"); logFilter=btn.dataset.level;
    });
});
document.getElementById("log-clear").addEventListener("click",()=>logScroll.innerHTML="");

// ─── Metrics ─────────────────────────────────────────────────────────────────
const mUptime=document.getElementById("m-uptime"),mFps=document.getElementById("m-fps");
const mMem=document.getElementById("m-mem"),mProcs=document.getElementById("m-procs");
const mWins=document.getElementById("m-wins"),procScroll=document.getElementById("proc-scroll");
const fpsBadge=document.getElementById("fps-badge");
let fps=0,fCount=0,lastFpsT=performance.now();

function updateSidePanel(s){
    if(!s)return;
    const u=Math.floor(s.uptime||0);
    mUptime.textContent=`${Math.floor(u/3600)}h ${Math.floor((u%3600)/60)}m ${u%60}s`;
    mMem.textContent=s.memory?`${(s.memory.used/1024/1024).toFixed(0)}/${(s.memory.total/1024/1024).toFixed(0)}M`:"--";
    mProcs.textContent=s.processes??0; mWins.textContent=s.windows??0;
    if(s.processList){
        procScroll.innerHTML="";
        for(const p of s.processList){
            const r=document.createElement("div");r.className="proc-row";
            r.innerHTML=`<span class="proc-pid">${p.pid}</span><span class="proc-name">${p.name}</span><span class="proc-state ${p.state}">${p.state}</span>`;
            procScroll.appendChild(r);
        }
    }
}

// ─── Offscreen ────────────────────────────────────────────────────────────────
function getOff(id,w,h){
    let e=offscreens.get(id);
    if(!e||e.canvas.width!==w||e.canvas.height!==h){
        const c=document.createElement("canvas");c.width=w;c.height=h;
        e={canvas:c,ctx:c.getContext("2d")};offscreens.set(id,e);
    }
    return e;
}
function execCmds(c,cmds){
    for(const cmd of cmds){switch(cmd.type){
        case"rect":if(!cmd.color||cmd.color==="transparent")break;c.fillStyle=cmd.color;c.fillRect(cmd.x,cmd.y,cmd.width,cmd.height);break;
        case"rrect":{if(!cmd.color||cmd.color==="transparent")break;c.fillStyle=cmd.color;rrect(c,cmd.x,cmd.y,cmd.width,cmd.height,cmd.radius||6);c.fill();if(cmd.stroke){c.strokeStyle=cmd.stroke;c.lineWidth=cmd.strokeWidth||1;c.stroke();}break;}
        case"textselect":{
            const prevFont=c.font;
            c.font=cmd.font||"12px 'A2G',system-ui";
            const x0=c.measureText(cmd.pre||"").width;
            const sw=c.measureText(cmd.sel||"").width;
            if(sw>0){c.fillStyle=cmd.selColor||"#bfdbfe";c.fillRect(Math.round(cmd.x+x0),cmd.y,Math.ceil(sw),cmd.height);}
            c.font=prevFont;break;}
        case"textcursor":{
            const prevFont=c.font;
            c.font=cmd.font||"12px 'A2G',system-ui";
            const tw=c.measureText(cmd.text||"").width;
            c.fillStyle=cmd.color||"#3b82f6";
            c.fillRect(Math.round(cmd.x+tw),cmd.y,1.5,cmd.height);
            c.font=prevFont;break;}
        case"text":if(!cmd.text)break;c.font=cmd.font||"13px 'A2G',system-ui";c.fillStyle=cmd.color||L.text;c.fillText(cmd.text,cmd.x,cmd.y);break;
        case"line":c.strokeStyle=cmd.color||L.border;c.lineWidth=1;c.beginPath();c.moveTo(cmd.x,cmd.y);c.lineTo(cmd.x2,cmd.y2);c.stroke();break;
        case"circle":c.fillStyle=cmd.color||L.text;c.beginPath();c.arc(cmd.x,cmd.y,cmd.radius,0,Math.PI*2);c.fill();break;
        case"clear":c.fillStyle=cmd.color||L.winBg;c.fillRect(0,0,c.canvas.width,c.canvas.height);break;
    }}
}

// ─── Chrome geometry ──────────────────────────────────────────────────────────
function outer(win){
    if(win.decorations===false) return{x:win.x,y:win.y,w:win.width,h:win.height,noChrome:true};
    return{x:win.x-BORDER,y:win.y-TITLE_H-BORDER,w:win.width+BORDER*2,h:win.height+TITLE_H+BORDER*2};
}
function btnCX(win){
    const o=outer(win), cy=o.y+TITLE_H/2+BORDER/2;
    return[{x:o.x+BTN_PAD,cy,action:"close"},{x:o.x+BTN_PAD+BTN_GAP,cy,action:"min"},{x:o.x+BTN_PAD+BTN_GAP*2,cy,action:"max"}];
}
function resizeEdge(win,mx,my){
    if(!win.resizable||win.state==="MAXIMIZED")return null;
    const o=outer(win);const r=o.x+o.w,b=o.y+o.h;
    if(mx<o.x||mx>r||my<o.y||my>b)return null;
    const E=RESIZE_HIT;
    const atR=mx>=r-E,atB=my>=b-E,atL=mx<=o.x+E;
    const inTitle=my<=o.y+TITLE_H+BORDER&&win.decorations!==false;
    if(inTitle&&!atR&&!atL&&!atB)return null;
    if(atB&&atR)return"se";if(atB&&atL)return"sw";
    if(atR)return"e";if(atB)return"s";if(atL)return"w";
    return null;
}
const EC={e:"ew-resize",w:"ew-resize",s:"ns-resize",se:"nwse-resize",sw:"nesw-resize"};

// ─── Dock (permanent apps + separator + open windows) ────────────────────────
const PERM_APPS=[
    {id:"files",    label:"Files",    color:"#3b82f6"},
    {id:"terminal", label:"Terminal", color:"#18181b"},
    {id:"settings", label:"Settings", color:"#6366f1"},
    {id:"allapps",  label:"All Apps", color:"#71717a"},
];
const PERM_ICONS={files:"📁",terminal:"💻",settings:"⚙️",allapps:"◉"};

function dockVis(){return windows.filter(w=>w.title!=="__desktop__");}

function computeDock(){
    const vis=dockVis();
    const permN=PERM_APPS.length, winN=vis.length;
    const sep=winN>0?1:0;
    const total=permN+sep+winN;
    const slotW=D_BASE+D_PAD*2;
    const pillW=total*slotW+(sep?8:0);
    const pillH=D_BASE+D_VPAD*2;
    const pillX=(displayW-pillW)/2;
    const pillY=displayH-D_BOT-pillH;
    const iconBot=pillY+pillH-D_VPAD;

    // Slot center Xs
    const slots=[];
    for(let i=0;i<total;i++) slots.push(pillX+i*slotW+slotW/2+(sep&&i>=permN?8:0));

    // Magnification — disabled when launcher is open
    const sizes=slots.map(cx=>{
        if(launcherOpen) return D_BASE;
        const dist=Math.hypot(cMouseX-cx,cMouseY-(iconBot-D_BASE/2));
        const t=Math.max(0,1-dist/D_MAG_R);
        return D_BASE+(D_MAX-D_BASE)*t*t;
    });

    // Push offsets
    const pushX=new Array(total).fill(0);
    for(let i=0;i<total;i++){
        const delta=sizes[i]-D_BASE;if(delta<0.5)continue;
        for(let j=0;j<total;j++){if(j===i)continue;const falloff=Math.max(0,1-Math.abs(j-i)*0.6);pushX[j]+=(j<i?-1:1)*delta*D_PUSH*falloff;}
    }

    const items=[];
    PERM_APPS.forEach((app,i)=>{
        const sz=sizes[i],cx=slots[i]+pushX[i],iy=iconBot-sz;
        items.push({kind:"perm",appId:app.id,label:app.label,color:app.color,cx,iy,size:sz,slotCX:slots[i]});
    });
    if(sep){
        const i=permN;
        items.push({kind:"sep",cx:slots[i],iy:iconBot-D_BASE,size:D_BASE,slotCX:slots[i]});
    }
    vis.forEach((w,wi)=>{
        const i=permN+sep+wi;
        const sz=sizes[i],cx=slots[i]+pushX[i],iy=iconBot-sz;
        items.push({kind:"win",...w,cx,iy,size:sz,slotCX:slots[i]});
    });
    return{items,pillX,pillW,pillY,pillH};
}

const ICON_PAL=["#3b82f6","#8b5cf6","#ec4899","#f97316","#22c55e","#06b6d4","#84cc16","#ef4444"];
function iconCol(id){return ICON_PAL[(id-1)%ICON_PAL.length];}

// ─── Main render ──────────────────────────────────────────────────────────────
function render(){
    // Desktop background + wallpaper
    const wp=WALLPAPERS.find(w=>w.id===currentWallpaper)||WALLPAPERS[0];
    const bgVal=currentTheme==="dark"?wp.dark:wp.bg;
    if(bgVal&&bgVal.startsWith("linear-gradient")){
        const cols=bgVal.match(/#[0-9a-f]{6}/gi)||[L.deskBg,L.deskBg];
        const grad=ctx.createLinearGradient(0,0,displayW,displayH);
        grad.addColorStop(0,cols[0]);grad.addColorStop(1,cols[1]||cols[0]);
        ctx.fillStyle=grad;
    } else { ctx.fillStyle=bgVal||L.deskBg; }
    ctx.fillRect(0,0,displayW,displayH);

    ctx.fillStyle=L.deskGrid;
    const GS=48;
    for(let gx=GS;gx<displayW;gx+=GS)
        for(let gy=MENU_BAR_H+GS;gy<displayH;gy+=GS)
            ctx.fillRect(gx-.5,gy-.5,1,1);

    const sorted=[...windows].sort((a,b)=>a.zIndex-b.zIndex);
    for(const win of sorted){
        if(win.state==="MINIMIZED")continue;
        if(win.title==="__desktop__"){drawDesktop(win);continue;}
        drawWindow(win);
    }
    drawDock();
    drawMenuBar();

    if(unifiedDrag&&unifiedDrag.active){
        const dx=unifiedDrag.curX,dy=unifiedDrag.curY;
        const lbl=unifiedDrag.label.length>24?unifiedDrag.label.slice(0,22)+"…":unifiedDrag.label;
        const icon=unifiedDrag.icon||"📄";
        const dark=currentTheme==="dark";

        // ── Drop-target highlight ─────────────────────────────────────────
        const tw2=winAt(dx,dy);
        if(tw2&&tw2.title&&tw2.title.startsWith("Files")){
            const lx2=dx-tw2.x,ly2=dy-tw2.y;
            const SB2=120,HDR2=36,ROW2=28,STA2=24,rowStart2=HDR2+22;
            if(lx2>=SB2&&ly2>=rowStart2&&ly2<tw2.height-STA2){
                const vi2=Math.floor((ly2-rowStart2)/ROW2);
                const rowAbsY=tw2.y+rowStart2+vi2*ROW2-2;
                // Check if the row is a folder by reading the windows array
                // (we highlight blue only when dropping onto a folder row)
                const dark2=currentTheme==="dark";
                ctx.save();
                ctx.globalAlpha=0.18;
                ctx.fillStyle=L.blue;
                ctx.fillRect(tw2.x+SB2+1,rowAbsY,tw2.width-SB2-2,ROW2);
                ctx.globalAlpha=0.6;
                ctx.strokeStyle=L.blue;ctx.lineWidth=1.5;
                ctx.strokeRect(tw2.x+SB2+1,rowAbsY,tw2.width-SB2-2,ROW2);
                ctx.restore();
            } else {
                // Hovering over FE header/sidebar → highlight whole window border
                const o2=outer(tw2);ctx.save();ctx.strokeStyle=L.blue;ctx.lineWidth=2;ctx.globalAlpha=0.45;
                ctx.strokeRect(o2.x,o2.y,o2.w,o2.h);ctx.restore();
            }
        } else if(!tw2||tw2.title==="__desktop__"){
            // Drop target is desktop — draw subtle indicator
            const dark2=currentTheme==="dark";
            ctx.save();ctx.strokeStyle=L.blue;ctx.lineWidth=2;ctx.globalAlpha=0.2;
            ctx.strokeRect(2,2,displayW-4,displayH-4);
            ctx.restore();
        }

        ctx.save();ctx.globalAlpha=0.92;
        // Shadow
        ctx.shadowColor="rgba(0,0,0,0.3)";ctx.shadowBlur=12;ctx.shadowOffsetY=3;
        rrect(ctx,dx-64,dy-16,128,32,8);
        ctx.fillStyle=dark?"#1e1e2e":"#eff6ff";ctx.fill();
        ctx.shadowColor="transparent";
        ctx.strokeStyle=L.blue;ctx.lineWidth=1;ctx.stroke();
        // Icon + label
        const multiCount=unifiedDrag.kind==="desktop"&&unifiedDrag.selectedCount>1?` (×${unifiedDrag.selectedCount})`:
                          unifiedDrag.kind==="fe"&&unifiedDrag.feSelCount>1?` (×${unifiedDrag.feSelCount})`:"";
        ctx.font="14px sans-serif";ctx.textAlign="left";ctx.textBaseline="middle";ctx.fillText(icon,dx-56,dy);
        ctx.font=F(12,400);ctx.fillStyle=dark?"#c8c8dd":L.blue;
        ctx.fillText(lbl+multiCount,dx-38,dy);
        ctx.textAlign="left";ctx.textBaseline="alphabetic";
        ctx.restore();
    }
    if(ctxMenu) drawCtxMenu();
    if(launcherOpen) drawLauncher();
    drawCursor(cMouseX,cMouseY);
}

function drawDesktop(win){
    if(win.drawCommands&&win.drawCommands.length>0){
        const off=getOff(win.id,win.width,win.height);
        off.ctx.clearRect(0,0,win.width,win.height);
        execCmds(off.ctx,win.drawCommands);
        ctx.drawImage(off.canvas,win.x,win.y);
    }
    // (no right-column dock ghost — dock is at bottom)
}

function drawWindow(win){
    const o=outer(win),foc=win.focused;
    const WRAD=8; // window corner radius

    if(o.noChrome){
        ctx.fillStyle=win.bgColor||L.winBg;ctx.fillRect(win.x,win.y,win.width,win.height);
        blitContent(win);return;
    }

    // Drop shadow (rounded)
    ctx.save();
    ctx.shadowColor=foc?L.shadowFoc:L.shadow;
    ctx.shadowBlur=foc?24:10;ctx.shadowOffsetY=foc?5:2;
    rrect(ctx,o.x,o.y,o.w,o.h,WRAD+1);
    ctx.fillStyle=foc?L.borderFoc:L.borderBlr;ctx.fill();
    ctx.restore();

    // Clip entire window to rounded rect
    ctx.save();
    rrect(ctx,o.x,o.y,o.w,o.h,WRAD);
    ctx.clip();

    // Outer border fill
    ctx.fillStyle=foc?L.borderFoc:L.borderBlr;
    ctx.fillRect(o.x,o.y,o.w,o.h);

    // Title bar
    ctx.fillStyle=L.titleBar;
    ctx.fillRect(o.x+BORDER,o.y+BORDER,o.w-BORDER*2,TITLE_H-1);

    // Title bar bottom divider
    ctx.fillStyle=L.border;
    ctx.fillRect(o.x+BORDER,o.y+BORDER+TITLE_H-1,o.w-BORDER*2,1);

    // Content area
    ctx.fillStyle=win.bgColor||L.winBg;
    ctx.fillRect(win.x,win.y,win.width,win.height);

    // Blit window content inside clip
    if(win.drawCommands&&win.drawCommands.length>0){
        const off=getOff(win.id,win.width,win.height);
        off.ctx.fillStyle=win.bgColor||L.winBg;
        off.ctx.fillRect(0,0,win.width,win.height);
        execCmds(off.ctx,win.drawCommands);
        ctx.drawImage(off.canvas,win.x,win.y);
    }

    ctx.restore(); // end clip

    // Border stroke (drawn AFTER clip restore so corners are crisp)
    rrect(ctx, o.x, o.y, o.w, o.h, WRAD);
    ctx.strokeStyle = foc ? L.borderFoc : L.borderBlr;
    ctx.lineWidth   = BORDER * 2; // straddles the edge
    ctx.stroke();

    // Traffic-light buttons (drawn after clip restore for crisp circles)
    const btns=btnCX(win);
    const bClr=[L.btnClose,L.btnMin,L.btnMax];
    btns.forEach((b,i)=>{
        ctx.beginPath();ctx.arc(b.x,b.cy,BTN_R,0,Math.PI*2);
        ctx.fillStyle=foc?bClr[i]:L.border;ctx.fill();
    });

    // Title text
    ctx.font="13px 'A2G',system-ui,sans-serif";
    ctx.fillStyle=foc?L.text2:L.text3;
    ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(win.title,o.x+o.w/2,o.y+BORDER+TITLE_H/2,o.w-180);
    ctx.textAlign="left";ctx.textBaseline="alphabetic";

    // Resize grip (subtle lines in bottom-right)
    if(win.resizable&&win.state!=="MAXIMIZED"&&foc){
        const rx=win.x+win.width,ry=win.y+win.height;
        ctx.strokeStyle=L.border2;ctx.lineWidth=1;
        for(let d=5;d<=11;d+=3){
            ctx.beginPath();ctx.moveTo(rx-d,ry);ctx.lineTo(rx,ry-d);ctx.stroke();
        }
    }
}

function blitContent(win){
    if(!win.drawCommands||win.drawCommands.length===0)return;
    const off=getOff(win.id,win.width,win.height);
    off.ctx.fillStyle=win.bgColor||L.winBg;
    off.ctx.fillRect(0,0,win.width,win.height);
    execCmds(off.ctx,win.drawCommands);
    ctx.drawImage(off.canvas,win.x,win.y);
}

// ─── Dock ─────────────────────────────────────────────────────────────────────
function drawDock(){
    const{items,pillX,pillW,pillY,pillH}=computeDock();
    if(items.length===0)return;

    // Pill backdrop
    ctx.save();
    ctx.shadowColor="rgba(0,0,0,0.12)";ctx.shadowBlur=16;ctx.shadowOffsetY=3;
    rrect(ctx,pillX,pillY,pillW,pillH,14);
    ctx.fillStyle=L.dockBg;ctx.fill();
    ctx.restore();
    rrect(ctx,pillX,pillY,pillW,pillH,14);
    ctx.strokeStyle=L.dockBorder;ctx.lineWidth=1;ctx.stroke();

    for(const it of items){
        if(it.kind==="sep"){
            ctx.fillStyle="rgba(0,0,0,0.1)";
            ctx.fillRect(Math.round(it.cx)-1,pillY+10,1,pillH-20);
            continue;
        }
        const{cx,iy,size,slotCX}=it;
        const r=size*0.20;

        // Icon background
        ctx.save();
        ctx.shadowColor="rgba(0,0,0,0.15)";ctx.shadowBlur=6;ctx.shadowOffsetY=2;
        rrect(ctx,cx-size/2,iy,size,size,r);
        ctx.fillStyle=it.kind==="perm"?it.color:iconCol(it.id);ctx.fill();
        ctx.restore();

        // Letter / emoji
        const fSz=Math.round(size*0.42);
        ctx.font=`600 ${fSz}px 'A2G',system-ui,sans-serif`;
        ctx.fillStyle="rgba(255,255,255,0.95)";
        ctx.textAlign="center";ctx.textBaseline="middle";
        const label=it.kind==="perm"?(PERM_ICONS[it.appId]||"●"):(it.title||"?").charAt(0).toUpperCase();
        ctx.fillText(label,cx,iy+size*0.5);
        ctx.textAlign="left";ctx.textBaseline="alphabetic";

        // Running dot below pill (only for open windows)
        if(it.kind==="win"){
            ctx.beginPath();ctx.arc(slotCX,displayH-D_BOT-3,2,0,Math.PI*2);
            ctx.fillStyle=it.id===focusedId?"#18181b":it.state==="MINIMIZED"?L.border2:L.text3;
            ctx.fill();
        }

        // Tooltip
        if(size>D_BASE+14) drawTooltip(it.label||it.title||"",cx,iy-6);
    }
}

// ─── Launcher Overlay ─────────────────────────────────────────────────────────
function drawLauncher(){
    if(!launcherOpen)return;
    const dark=currentTheme==="dark";

    // Panel dimensions — slightly wider, centered
    const OW=520, OH=380;
    const ox=Math.round((displayW-OW)/2);
    const oy=MENU_BAR_H+50;

    // Full-screen dim (covers dock too → mouse-over blocked)
    ctx.fillStyle="rgba(0,0,0,0.38)";
    ctx.fillRect(0,0,displayW,displayH);

    // Panel shadow
    ctx.save();
    ctx.shadowColor="rgba(0,0,0,0.45)";ctx.shadowBlur=48;ctx.shadowOffsetY=12;
    rrect(ctx,ox,oy,OW,OH,18);
    ctx.fillStyle=dark?"rgba(22,22,24,0.96)":"rgba(248,248,250,0.97)";
    ctx.fill();
    ctx.restore();

    // Panel stroke
    rrect(ctx,ox,oy,OW,OH,18);
    ctx.strokeStyle=dark?"rgba(255,255,255,0.06)":"rgba(0,0,0,0.07)";
    ctx.lineWidth=1;ctx.stroke();

    // ── Search bar ───────────────────────────────────────────────────────────
    const SX=ox+20, SY=oy+20, SW=OW-40, SH=38;
    rrect(ctx,SX,SY,SW,SH,10);
    ctx.fillStyle=dark?"rgba(255,255,255,0.05)":"rgba(0,0,0,0.04)";ctx.fill();
    ctx.strokeStyle=dark?"rgba(255,255,255,0.10)":"rgba(0,0,0,0.09)";ctx.lineWidth=1;ctx.stroke();

    // Search icon ⌕
    ctx.font=`15px ${FONT_UI}`;
    ctx.fillStyle=dark?"#606060":"#b0b0b0";
    ctx.textAlign="left";ctx.textBaseline="middle";
    ctx.fillText("⌕",SX+11,SY+SH/2);

    // Search text + cursor — clipped to search bar
    const q=launcherField.value;
    const cur=launcherField.cursor;
    const elapsed=Date.now()-launcherField.blink;
    const showCaret=(elapsed<500)||(Math.floor(elapsed/500)%2===0);
    const textX=SX+35;
    const textMaxW=SW-42; // available width for text (right of icon, left of edge)
    ctx.font=`400 14px ${FONT_UI}`;

    // Clip to search bar interior
    ctx.save();
    ctx.beginPath();ctx.rect(textX,SY+1,textMaxW,SH-2);ctx.clip();

    if(!q){
        ctx.fillStyle=dark?"#505055":"#b0b0b0";
        ctx.fillText("Search apps…",textX,SY+SH/2);
        if(showCaret){
            ctx.fillStyle=dark?"#a0a0a8":"#555555";
            ctx.fillRect(textX,SY+9,1.5,SH-18);
        }
    } else {
        // Scroll text so cursor stays visible
        const fullW=ctx.measureText(q).width;
        const curW=ctx.measureText(q.slice(0,cur)).width;
        let scrollX=0;
        if(curW>textMaxW-8) scrollX=curW-(textMaxW-8);
        else if(fullW>textMaxW) scrollX=Math.max(0,fullW-textMaxW+4);
        const tx=textX-scrollX;

        // Selection highlight
        if(launcherField.selStart!==null){
            const a=Math.min(launcherField.selStart,cur);
            const b=Math.max(launcherField.selStart,cur);
            const pw=ctx.measureText(q.slice(0,a)).width;
            const sw=ctx.measureText(q.slice(a,b)).width;
            ctx.fillStyle="#3b82f6";
            ctx.fillRect(tx+pw,SY+8,sw,SH-16);
        }
        ctx.fillStyle=dark?"#f0f0f4":"#111111";
        ctx.fillText(q,tx,SY+SH/2);
        // Caret
        if(showCaret){
            const pw=ctx.measureText(q.slice(0,cur)).width;
            ctx.fillStyle=dark?"#f0f0f4":"#222222";
            ctx.fillRect(tx+pw,SY+9,1.5,SH-18);
        }
    }
    ctx.restore();
    ctx.textAlign="left";ctx.textBaseline="alphabetic";

    // ── Section label ─────────────────────────────────────────────────────────
    ctx.font=`600 9px ${FONT_UI}`;
    ctx.fillStyle=dark?"#444":"#bbb";
    ctx.textAlign="left";ctx.textBaseline="middle";
    ctx.fillText(q?"RESULTS":"ALL APPS",ox+20,oy+76);
    ctx.textAlign="left";ctx.textBaseline="alphabetic";

    // ── App grid ─────────────────────────────────────────────────────────────
    const filtered=q
        ? LAUNCHER_APPS.filter(a=>a.label.toLowerCase().includes(q.toLowerCase()))
        : LAUNCHER_APPS;

    if(filtered.length===0){
        ctx.font=`400 13px ${FONT_UI}`;
        ctx.fillStyle=dark?"#555":"#aaa";
        ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText('No results for "'+q+'"',ox+OW/2,oy+200);
        ctx.textAlign="left";ctx.textBaseline="alphabetic";
        return;
    }

    // Layout: left-aligned grid
    const COLS=Math.min(filtered.length,5);
    const ICON_SZ=60;
    const CELL_W=90;
    const CELL_H=ICON_SZ+34;
    const PAD_L=24;
    const gx=ox+PAD_L;
    const gy=oy+90;

    filtered.forEach((app,i)=>{
        const col=i%COLS, row=Math.floor(i/COLS);
        const ix=gx+col*CELL_W;   // icon left edge
        const iy=gy+row*CELL_H;   // icon top edge

        // Hover highlight
        const hov=(cMouseX>=ix-4&&cMouseX<ix+ICON_SZ+4&&cMouseY>=iy-4&&cMouseY<iy+CELL_H-2);
        if(hov){
            ctx.save();
            rrect(ctx,ix-4,iy-4,ICON_SZ+8,CELL_H-2,10);
            ctx.fillStyle=dark?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.05)";
            ctx.fill();
            ctx.restore();
        }

        // Icon background
        ctx.save();
        ctx.shadowColor="rgba(0,0,0,0.18)";ctx.shadowBlur=8;ctx.shadowOffsetY=2;
        rrect(ctx,ix,iy,ICON_SZ,ICON_SZ,14);
        ctx.fillStyle=app.color;ctx.fill();
        ctx.restore();

        // Emoji (after restore — no shadow)
        const EM=Math.round(ICON_SZ*0.46);
        ctx.save();
        ctx.font=`${EM}px sans-serif`;
        ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillStyle="#ffffff";
        ctx.fillText(app.icon,ix+ICON_SZ/2,iy+ICON_SZ/2);
        ctx.restore();

        // Label — left-aligned under icon
        ctx.save();
        ctx.font=`400 11px ${FONT_UI}`;
        ctx.fillStyle=dark?"#c8c8cc":"#3a3a3f";
        ctx.textAlign="left";ctx.textBaseline="top";
        const lbl=app.label.length>11?app.label.slice(0,10)+"…":app.label;
        ctx.fillText(lbl,ix,iy+ICON_SZ+6);
        ctx.restore();
    });
}

function _launcherClick(mx,my){
    if(!launcherOpen)return false;
    const OW=520, OH=380;
    const ox=Math.round((displayW-OW)/2);
    const oy=MENU_BAR_H+50;

    // Click outside panel → close
    if(mx<ox||mx>ox+OW||my<oy||my>oy+OH){
        launcherOpen=false;
        launcherField={value:"",cursor:0,selStart:null,blink:Date.now(),_lastClick:0,_lastClickPos:-1};
        return true;
    }

    // Click on app icon
    const filtered=launcherField.value
        ? LAUNCHER_APPS.filter(a=>a.label.toLowerCase().includes(launcherField.value.toLowerCase()))
        : LAUNCHER_APPS;
    const COLS=Math.min(filtered.length,5);
    const ICON_SZ=60, CELL_W=90, CELL_H=ICON_SZ+34;
    const PAD_L=24;
    const gx=ox+PAD_L;
    const gy=oy+90;

    for(let i=0;i<filtered.length;i++){
        const col=i%COLS, row=Math.floor(i/COLS);
        const ix=gx+col*CELL_W, iy=gy+row*CELL_H;
        if(mx>=ix-4&&mx<ix+ICON_SZ+4&&my>=iy-4&&my<iy+CELL_H){
            launcherOpen=false;
            launcherField={value:"",cursor:0,selStart:null,blink:Date.now(),_lastClick:0,_lastClickPos:-1};
            sendAppEvent(filtered[i].id);
            return true;
        }
    }
    return true; // consumed — even if no app hit, don't propagate
}

function _launcherKey(e){
    if(!launcherOpen)return false;
    if(e.key==="Escape"){launcherOpen=false;launcherField={value:"",cursor:0,selStart:null,blink:Date.now(),_lastClick:0,_lastClickPos:-1};return true;}
    if(e.key==="Enter"){
        const filtered=launcherField.value?LAUNCHER_APPS.filter(a=>a.label.toLowerCase().includes(launcherField.value.toLowerCase())):LAUNCHER_APPS;
        if(filtered.length>0){
            launcherOpen=false;launcherField={value:"",cursor:0,selStart:null,blink:Date.now(),_lastClick:0,_lastClickPos:-1};
            window.alphaOS.sendEvent({type:"dock_app_click",appId:filtered[0].id});
        }
        return true;
    }
    // InputField-like handling
    const f=launcherField;
    f.blink=Date.now();
    const ctrl=e.ctrlKey||e.metaKey;
    const del=s=>f.selStart!==null?(f.value=f.value.slice(0,Math.min(f.selStart,f.cursor))+f.value.slice(Math.max(f.selStart,f.cursor)),f.cursor=Math.min(f.selStart,f.cursor),f.selStart=null,true):s;
    if(e.key==="Backspace"){if(!del(false)&&f.cursor>0){f.value=f.value.slice(0,f.cursor-1)+f.value.slice(f.cursor);f.cursor--;}}
    else if(e.key==="Delete"){if(!del(false)&&f.cursor<f.value.length){f.value=f.value.slice(0,f.cursor)+f.value.slice(f.cursor+1);}}
    else if(e.key==="ArrowLeft"){if(e.shiftKey&&f.selStart===null)f.selStart=f.cursor;else if(!e.shiftKey)f.selStart=null;f.cursor=Math.max(0,f.cursor-1);}
    else if(e.key==="ArrowRight"){if(e.shiftKey&&f.selStart===null)f.selStart=f.cursor;else if(!e.shiftKey)f.selStart=null;f.cursor=Math.min(f.value.length,f.cursor+1);}
    else if(e.key==="Home"){if(e.shiftKey&&f.selStart===null)f.selStart=f.cursor;else if(!e.shiftKey)f.selStart=null;f.cursor=0;}
    else if(e.key==="End"){if(e.shiftKey&&f.selStart===null)f.selStart=f.cursor;else if(!e.shiftKey)f.selStart=null;f.cursor=f.value.length;}
    else if(ctrl&&e.key.toLowerCase()==="a"){f.selStart=0;f.cursor=f.value.length;}
    else if(e.key.length===1&&!ctrl){del(false);f.value=f.value.slice(0,f.cursor)+e.key+f.value.slice(f.cursor);f.cursor++;}
    return true;
}


const MENU_DEFS = {
    apple: [
        {label:"About AlphaOS",   action:"sysinfo"},
        {label:"---"},
        {label:"Settings…",       action:"settings"},
        {label:"---"},
        {label:"Restart",         action:"restart"},
        {label:"Shut Down",       action:"shutdown",danger:true},
    ],
    file: [
        {label:"New Text File",   action:"newfile"},
        {label:"New Terminal",    action:"terminal"},
        {label:"Open Files",      action:"files"},
        {label:"---"},
        {label:"All Apps",        action:"allapps"},
    ],
};

let _clockStr="";
(function tick(){
    const n=new Date();
    const p=v=>String(v).padStart(2,"0");
    _clockStr=`${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
    setTimeout(tick,1000-n.getMilliseconds());
})();

function drawMenuBar(){
    const H=MENU_BAR_H;
    const col=L.menuBar||"rgba(245,245,247,0.94)";
    const textCol=L.menuBarText||L.text;

    // Backdrop blur via solid fill (canvas can't do blur easily)
    ctx.save();
    ctx.fillStyle=col;
    ctx.fillRect(0,0,displayW,H);
    // Bottom border
    ctx.fillStyle=L.menuBarBorder||"rgba(0,0,0,0.08)";
    ctx.fillRect(0,H-1,displayW,1);
    ctx.restore();

    // Apple / logo
    ctx.font=`${16}px ${FONT_UI}`;
    ctx.fillStyle=textCol;ctx.textAlign="left";ctx.textBaseline="middle";
    ctx.fillText("⌘",10,H/2);

    // Menu items
    let mx=36;
    const MENUS=[{key:"apple",label:"AlphaOS"},{key:"file",label:"File"}];
    ctx.font=`500 ${12}px ${FONT_UI}`; // set font BEFORE measureText
    for(const m of MENUS){
        const isOpen=menuBarOpen===m.key;
        const tw=ctx.measureText(m.label).width;
        if(isOpen){
            rrect(ctx,mx-6,2,tw+12,H-4,4);
            ctx.fillStyle=currentTheme==="dark"?"rgba(255,255,255,0.12)":"rgba(0,0,0,0.08)";
            ctx.fill();
        }
        ctx.fillStyle=textCol;ctx.textAlign="left";ctx.textBaseline="middle";
        ctx.fillText(m.label,mx,H/2);
        mx+=tw+20;
    }

    // Clock (right side)
    ctx.font=`400 ${12}px ${FONT_UI}`;
    ctx.fillStyle=textCol;ctx.textAlign="right";ctx.textBaseline="middle";
    ctx.fillText(_clockStr,displayW-10,H/2);
    ctx.textAlign="left";ctx.textBaseline="alphabetic";

    // Open dropdown
    if(menuBarOpen&&menuBarItems){
        const DROP_W=200,ITEM_H=30,PAD=4;
        const totalH=menuBarItems.reduce((s,it)=>s+(it.label==="---"?8:ITEM_H),0)+PAD*2;
        const ddX=menuBarItems._x||10, ddY=H;
        ctx.save();
        ctx.shadowColor="rgba(0,0,0,0.18)";ctx.shadowBlur=16;ctx.shadowOffsetY=4;
        rrect(ctx,ddX,ddY,DROP_W,totalH,8);
        ctx.fillStyle=L.menuBar||"rgba(245,245,247,0.97)";ctx.fill();
        ctx.restore();
        ctx.strokeStyle=L.menuBarBorder||"rgba(0,0,0,0.08)";ctx.lineWidth=1;ctx.stroke();

        let iy=ddY+PAD;
        menuBarItems.forEach(item=>{
            if(item.label==="---"){ctx.fillStyle=L.border;ctx.fillRect(ddX+8,iy+3,DROP_W-16,1);iy+=8;return;}
            if(cMouseX>=ddX&&cMouseX<ddX+DROP_W&&cMouseY>=iy&&cMouseY<iy+ITEM_H){
                rrect(ctx,ddX+4,iy+2,DROP_W-8,ITEM_H-4,5);
                ctx.fillStyle=currentTheme==="dark"?"rgba(255,255,255,0.1)":"rgba(0,0,0,0.07)";ctx.fill();
            }
            ctx.font=`400 ${13}px ${FONT_UI}`;
            ctx.fillStyle=item.danger?"#ef4444":L.menuBarText||L.text;
            ctx.textAlign="left";ctx.textBaseline="middle";
            ctx.fillText(item.label,ddX+14,iy+ITEM_H/2);
            iy+=ITEM_H;
        });
        ctx.textAlign="left";ctx.textBaseline="alphabetic";
    }
}

function _menuBarClick(mx,my){
    if(my>MENU_BAR_H){ menuBarOpen=null;menuBarItems=null;return false;}
    const MENUS=[{key:"apple",label:"AlphaOS"},{key:"file",label:"File"}];
    let bx=36;
    ctx.font=`500 12px ${FONT_UI}`;
    for(const m of MENUS){
        const tw=ctx.measureText(m.label).width;
        const hitX=bx-6, hitW=tw+12; // match background rrect exactly
        if(mx>=hitX&&mx<hitX+hitW){
            if(menuBarOpen===m.key){menuBarOpen=null;menuBarItems=null;}
            else{menuBarOpen=m.key;menuBarItems=[...MENU_DEFS[m.key]];menuBarItems._x=hitX;}
            return true;
        }
        bx+=tw+20;
    }
    menuBarOpen=null;menuBarItems=null;
    return true;
}

function _menuBarDropClick(mx,my){
    if(!menuBarOpen||!menuBarItems)return false;
    const DROP_W=200,ITEM_H=30,PAD=4;
    const ddX=menuBarItems._x||10, ddY=MENU_BAR_H;
    let iy=ddY+PAD;
    for(const item of menuBarItems){
        if(item.label==="---"){iy+=8;continue;}
        if(mx>=ddX&&mx<ddX+DROP_W&&my>=iy&&my<iy+ITEM_H){
            menuBarOpen=null;menuBarItems=null;
            _execMenuAction(item.action);
            return true;
        }
        iy+=ITEM_H;
    }
    return false;
}

function _execMenuAction(action){
    switch(action){
        case"sysinfo":  window.alphaOS.sendEvent({type:"dock_app_click",appId:"sysinfo"});break;
        case"settings": window.alphaOS.sendEvent({type:"dock_app_click",appId:"settings"});break;
        case"restart":  window.alphaOS.sendEvent({type:"dock_app_click",appId:"restart"});break;
        case"shutdown": window.alphaOS.sendEvent({type:"shutdown_request"});break;
        case"newfile":  window.alphaOS.sendEvent({type:"dock_app_click",appId:"newfile"});break;
        case"terminal": window.alphaOS.sendEvent({type:"dock_app_click",appId:"terminal"});break;
        case"files":    window.alphaOS.sendEvent({type:"dock_app_click",appId:"files"});break;
        case"allapps":  launcherOpen=true;launcherField={value:"",cursor:0,selStart:null,blink:Date.now(),_lastClick:0,_lastClickPos:-1};break;
    }
}


function drawTooltip(text,cx,tipBot){
    ctx.font="11px 'A2G',system-ui";
    const tw=ctx.measureText(text).width;
    const pw=tw+16,ph=22,px=cx-pw/2,py=tipBot-ph;
    ctx.save();ctx.shadowColor="rgba(0,0,0,0.12)";ctx.shadowBlur=8;
    rrect(ctx,px,py,pw,ph,6);ctx.fillStyle=L.bg;ctx.fill();ctx.restore();
    ctx.strokeStyle=L.border;ctx.lineWidth=1;ctx.stroke();
    ctx.fillStyle=L.text;ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(text,cx,py+ph/2);
    ctx.textAlign="left";ctx.textBaseline="alphabetic";
}

// ─── Desktop icon drag ────────────────────────────────────────────────────────
function drawDragIcon(){
    if(!unifiedDrag)return;
    const{curX:x,curY:y,icon,label}=unifiedDrag;
    const IW=72,IH=72;
    ctx.save();
    ctx.shadowColor="rgba(0,0,0,0.2)";ctx.shadowBlur=20;ctx.shadowOffsetY=6;
    ctx.globalAlpha=0.9;
    rrect(ctx,x-IW/2,y-IH/2,IW,IH,10);
    ctx.fillStyle=L.bg;ctx.fill();
    ctx.restore();
    ctx.globalAlpha=0.9;
    ctx.font="28px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(icon,x,y-8);
    ctx.font="11px 'A2G',system-ui";ctx.fillStyle=L.text2;
    ctx.fillText(label,x,y+18);
    ctx.textAlign="left";ctx.textBaseline="alphabetic";
    ctx.globalAlpha=1;
}

// ─── Context menu ─────────────────────────────────────────────────────────────
function drawCtxMenu(){
    const ITEM_H=32,MW=176,PAD=4;
    const totalH=ctxMenu.items.reduce((s,it)=>s+(it.label==="---"?8:ITEM_H),0)+PAD*2;
    const mx=Math.min(ctxMenu.x,displayW-MW-4);
    const my=Math.min(ctxMenu.y,displayH-totalH-4);

    ctx.save();ctx.shadowColor="rgba(0,0,0,0.12)";ctx.shadowBlur=16;ctx.shadowOffsetY=4;
    rrect(ctx,mx,my,MW,totalH,8);ctx.fillStyle=L.bg;ctx.fill();ctx.restore();
    ctx.strokeStyle=L.border;ctx.lineWidth=1;ctx.stroke();

    let iy=my+PAD;
    ctxMenu.items.forEach(item=>{
        if(item.label==="---"){ctx.fillStyle=L.border;ctx.fillRect(mx+8,iy+3,MW-16,1);iy+=8;return;}
        if(cMouseX>=mx&&cMouseX<mx+MW&&cMouseY>=iy&&cMouseY<iy+ITEM_H){
            rrect(ctx,mx+4,iy+2,MW-8,ITEM_H-4,5);ctx.fillStyle=L.muted;ctx.fill();
        }
        ctx.font=item.bold?`600 13px 'A2G',system-ui`:`13px 'A2G',system-ui`;
        ctx.fillStyle=item.danger?"#ef4444":item.bold?L.text3:L.text;
        ctx.textAlign="left";ctx.textBaseline="middle";
        ctx.fillText(item.label,mx+12,iy+ITEM_H/2);
        iy+=ITEM_H;
    });
    ctx.textAlign="left";ctx.textBaseline="alphabetic";
}

// ─── Cursor ───────────────────────────────────────────────────────────────────
function drawCursor(x,y){
    ctx.save();
    ctx.fillStyle=L.text;ctx.strokeStyle=L.bg;ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(x,y);ctx.lineTo(x,y+15);ctx.lineTo(x+3.5,y+10.5);
    ctx.lineTo(x+7,y+17);ctx.lineTo(x+9,y+16);ctx.lineTo(x+5.5,y+9.5);
    ctx.lineTo(x+11,y+9.5);ctx.closePath();
    ctx.stroke();ctx.fill();
    ctx.restore();
}

function rrect(c,x,y,w,h,r){
    c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);c.quadraticCurveTo(x+w,y,x+w,y+r);
    c.lineTo(x+w,y+h-r);c.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    c.lineTo(x+r,y+h);c.quadraticCurveTo(x,y+h,x,y+h-r);
    c.lineTo(x,y+r);c.quadraticCurveTo(x,y,x+r,y);c.closePath();
}

function loop(){render();requestAnimationFrame(loop);}
requestAnimationFrame(loop);

// ─── Kernel events ────────────────────────────────────────────────────────────
window.alphaOS.onKernelEvent(data=>{
    switch(data.type){
        case"boot_start":resizeCanvas(data.width||displayW,data.height||displayH);break;
        case"boot_complete":
            booted=true;clearInterval(bTimer);
            bootBar.style.width="100%";bootMsg.textContent="Ready.";
            setTimeout(()=>{splash.style.opacity="0";setTimeout(()=>splash.remove&&splash.remove(),500);},500);
            appendLog("info","Kernel booted");break;
        case"frame":
            if(Array.isArray(data.windows)){windows=data.windows;focusedId=data.focused;}
            if(data.status){
                updateSidePanel(data.status);
                fCount++;const now=performance.now();
                if(now-lastFpsT>=1000){fps=fCount;fCount=0;lastFpsT=now;
                    mFps.textContent=fps;fpsBadge.textContent=fps+" fps";}
            }
            break;
        case"fe_drag_info_result":{
            if(unifiedDrag&&unifiedDrag.kind==="fe"&&unifiedDrag.srcWinId===data.winId){
                if(data.name){
                    unifiedDrag.label=data.name;
                    if(data.selCount) unifiedDrag.feSelCount=data.selCount;
                } else {
                    // Empty row — cancel drag
                    unifiedDrag=null;
                }
            }
            break;
        }
        case"desktop_drag_info_result":{
            if(unifiedDrag&&unifiedDrag.kind==="desktop"&&data.name){
                unifiedDrag.label=data.name;
                if(data.icon) unifiedDrag.icon=data.icon;
                if(data.selCount) unifiedDrag.selectedCount=data.selCount;
            }
            break;
        }
        case"fe_context_menu_result":{
            ctxMenu={x:data.x,y:data.y,items:data.items.map((it,idx)=>({
                label:it.label,bold:!it.hasAction&&idx===0,danger:it.danger,
                action:it.hasAction?()=>window.alphaOS.sendEvent({type:"fe_context_action",winId:data.winId,lx:data.lx,ly:data.ly,idx}):undefined,
            }))};
            break;
        }
        case"desktop_context_menu_result":{
            ctxMenu={x:data.x,y:data.y,items:data.items.map((it,idx)=>({
                label:it.label,bold:!it.hasAction&&idx===0,danger:it.danger,
                action:it.hasAction?()=>window.alphaOS.sendEvent({type:"desktop_context_action",x:data.x,y:data.y,idx}):undefined,
            }))};
            break;
        }
        case"theme_change":{
            const dark=data.dark||false;
            applyTheme(dark?"dark":"light");
            // Sync HTML CSS vars
            const root=document.documentElement;
            root.style.setProperty("--bg",L.bg);
            root.style.setProperty("--surface",L.surface);
            root.style.setProperty("--border",L.border);
            root.style.setProperty("--muted",L.muted);
            root.style.setProperty("--text",L.text);
            root.style.setProperty("--text2",L.text2);
            root.style.setProperty("--text3",L.text3);
            break;
        }
        case"wallpaper_change":{
            applyWallpaper(data.id||"default");
            break;
        }
        case"log":appendLog(data.level||"info",data.message);break;

        case"clipboard_write":
            if(data.text!==undefined){
                // Use Electron clipboard (synchronous, no permission issues)
                if(window.alphaOS.clipboardWrite){
                    window.alphaOS.clipboardWrite(data.text);
                } else {
                    try{navigator.clipboard.writeText(data.text).catch(()=>{});}catch(_){}
                }
            }
            break;

        case"clipboard_read_request":
            if(data.winId){
                // Use Electron clipboard (synchronous)
                if(window.alphaOS.clipboardRead){
                    const text=window.alphaOS.clipboardRead();
                    window.alphaOS.sendEvent({type:"paste_text",winId:data.winId,text:text||""});
                } else {
                    navigator.clipboard.readText().then(text=>{
                        window.alphaOS.sendEvent({type:"paste_text",winId:data.winId,text});
                    }).catch(()=>{
                        window.alphaOS.sendEvent({type:"paste_text",winId:data.winId,text:""});
                    });
                }
            }
            break;
        case"shutdown":
            ctx.fillStyle="rgba(255,255,255,0.9)";ctx.fillRect(0,0,displayW,displayH);
            ctx.font="600 20px 'A2G',system-ui";ctx.fillStyle=L.text2;ctx.textAlign="center";
            ctx.fillText("System Halted",displayW/2,displayH/2);ctx.textAlign="left";break;
        case"panic":
            document.getElementById("panic-msg").textContent=data.message;
            document.getElementById("panic-overlay").classList.add("visible");break;
    }
});

// ─── Hit testing ─────────────────────────────────────────────────────────────
function winAt(mx,my){
    return[...windows].filter(w=>w.state!=="MINIMIZED"&&w.title!=="__desktop__")
        .sort((a,b)=>b.zIndex-a.zIndex)
        .find(w=>{const o=outer(w);return mx>=o.x&&mx<o.x+o.w&&my>=o.y&&my<o.y+o.h;})||null;
}
function inDock(my){const{pillY,pillH}=computeDock();return pillH>0&&my>=pillY-10;}
function dockItemAt(mx,my){
    const{items}=computeDock();
    for(const it of items){
        if(it.kind==="sep")continue;
        const half=Math.max(D_BASE,it.size)/2+D_PAD/2;
        const iy=displayH-D_BOT-D_VPAD-it.size;
        if(mx>=it.slotCX-half&&mx<it.slotCX+half&&my>=iy-8&&my<displayH)return it;
    }
    return null;
}
// Desktop: check if mouse is over a desktop file icon or dock app icon area
const DI_W=72,DI_H=72,DI_GAP=10;
// Returns the desktop window if mx,my is over any desktop content area
function desktopIconAt(mx,my){
    const dw=windows.find(w=>w.title==="__desktop__");
    if(!dw)return null;
    // Desktop file icons occupy left-top quadrant (AppManager renders them)
    // Just detect the right-column dock app icons area
    const IX=dw.width-DI_W-18;
    for(let i=0;i<PERM_APPS.length;i++){
        const iy=20+i*(DI_H+DI_GAP);
        if(mx>=IX-4&&mx<=IX+DI_W+4&&my>=iy-4&&my<=iy+DI_H+4)
            return{index:i,icon:PERM_ICONS[PERM_APPS[i].id]||"●",label:PERM_APPS[i].label,appId:PERM_APPS[i].id};
    }
    // Desktop file icons (left area, 88px grid)
    const PAD=20;
    if(mx>=PAD&&mx<dw.width-DI_W-18-10&&my>=PAD&&my<dw.height-80){
        return{index:-1,icon:"📄",label:"file",isDesktopFile:true};
    }
    return null;
}

function _ctxClick(mx,my){
    if(!ctxMenu)return;
    const ITEM_H=32,MW=176,PAD=4;
    const totalH=ctxMenu.items.reduce((s,it)=>s+(it.label==="---"?8:ITEM_H),0)+PAD*2;
    const bx=Math.min(ctxMenu.x,displayW-MW-4);
    const by=Math.min(ctxMenu.y,displayH-totalH-4);
    let iy=by+PAD;
    for(const item of ctxMenu.items){
        if(item.label==="---"){iy+=8;continue;}
        if(mx>=bx&&mx<bx+MW&&my>=iy&&my<iy+ITEM_H){
            if(item.action)item.action();
            break;
        }
        iy+=ITEM_H;
    }
}

// ─── Mouse ────────────────────────────────────────────────────────────────────
let _launcherSearchDrag = false;

// Helper: compute launcher search field geometry
function _launcherFieldOpts(){
    const OW=520;
    const ox=Math.round((displayW-OW)/2);
    const oy=MENU_BAR_H+50;
    // In drawLauncher: SX=ox+20, text starts at SX+35=ox+55
    const SX=ox+20, SY=oy+20, SH=38;
    const textX=SX+35;
    return {x:textX, y:SY, width:OW-40-35, height:SH, charW:8.0, padLeft:0};
}

// Handle mousedown on launcher search field
function _launcherSearchDown(mx,my){
    const OW=520,OH=380;
    const ox=Math.round((displayW-OW)/2),oy=MENU_BAR_H+50;
    if(mx<ox||mx>ox+OW||my<oy||my>oy+OH)return false;
    const SX=ox+20,SY=oy+20,SH=38;
    if(my<SY||my>SY+SH)return false;
    const textX=SX+35;
    const f=launcherField;
    const relX=Math.max(0,mx-textX);
    const col=_xToCharIdx(f.value,relX,"400 14px 'A2G',system-ui");
    const now=Date.now();
    if(f._lastClick&&now-f._lastClick<400&&Math.abs(col-(f._lastClickPos||0))<=2){
        const v=f.value;
        const isW=c=>/\w/.test(c);
        let a=col,b=col;
        if(col<v.length&&isW(v[col])){while(a>0&&isW(v[a-1]))a--;while(b<v.length&&isW(v[b]))b++;}
        else if(col>0&&isW(v[col-1])){b=col;while(a>0&&isW(v[a-1]))a--;}
        else{a=0;b=v.length;}
        f.selStart=a;f.cursor=b;f._lastClick=0;
    } else {
        f.cursor=col;f.selStart=null;f._lastClick=now;f._lastClickPos=col;
    }
    f.blink=Date.now();
    _launcherSearchDrag=true;
    return true;
}

canvasWrap.addEventListener("mousedown",e=>{
    canvasWrap.focus();updateMouse(e);
    const mx=cMouseX,my=cMouseY;
    // Launcher overlay
    if(launcherOpen){
        if(_launcherSearchDown(mx,my))return; // search bar click
        if(_launcherClick(mx,my))return;       // app icon or outside
    }
    // Menu bar dropdown click
    if(e.button===0&&menuBarOpen&&_menuBarDropClick(mx,my))return;
    // Menu bar click
    if(e.button===0&&my<MENU_BAR_H){_menuBarClick(mx,my);return;}
    if(e.button===0&&menuBarOpen){menuBarOpen=null;menuBarItems=null;}
    if(ctxMenu){if(e.button===0)_ctxClick(mx,my);ctxMenu=null;return;}
    // Right-click: let contextmenu handle it, don't touch selection/focus
    if(e.button===2) return;

    if(!launcherOpen&&inDock(my)){
        const item=dockItemAt(mx,my);
        if(item){
            if(item.kind==="perm"){
                sendAppEvent(item.appId);
            } else {
                if(item.state==="MINIMIZED")   window.alphaOS.sendEvent({type:"win_maximize",id:item.id});
                else if(item.id===focusedId)   window.alphaOS.sendEvent({type:"win_minimize",id:item.id});
                else                           window.alphaOS.sendEvent({type:"win_focus",id:item.id});
            }
        }
        return;
    }
    const win=winAt(mx,my);
    if(win){
        if(win.id!==focusedId){focusedId=win.id;window.alphaOS.sendEvent({type:"win_focus",id:win.id});}
        if(win.decorations!==false){
            for(const b of btnCX(win)){
                if(Math.hypot(mx-b.x,my-b.cy)<=BTN_R+3){
                    if(b.action==="close")window.alphaOS.sendEvent({type:"win_close",id:win.id});
                    if(b.action==="min")  window.alphaOS.sendEvent({type:"win_minimize",id:win.id});
                    if(b.action==="max")  window.alphaOS.sendEvent({type:"win_maximize",id:win.id});
                    return;
                }
            }
            const edge=resizeEdge(win,mx,my);
            if(edge){resize={winId:win.id,edge,startMX:mx,startMY:my,startX:win.x,startY:win.y,startW:win.width,startH:win.height};return;}
            const o=outer(win);
            if(my>=o.y&&my<o.y+TITLE_H+BORDER&&win.state!=="MAXIMIZED"){drag={winId:win.id,offX:mx-win.x,offY:my-win.y};return;}
        }
        window.alphaOS.sendEvent({type:"input_event",event:{type:"mousedown",timestamp:Date.now(),data:{x:Math.round(mx),y:Math.round(my),button:e.button,buttons:e.buttons,ctrl:e.ctrlKey,shift:e.shiftKey}}});
        // FE drag: start tracking on file row click
        if(e.button===0&&win.title&&win.title.startsWith("Files")){
            const SB=120,HDR=36,ROW=28,STA=24;
            const lx=mx-win.x,ly=my-win.y;
            if(lx>=SB&&ly>=HDR+22&&ly<win.height-STA){
                const vi=Math.floor((ly-(HDR+22))/ROW);
                // Count FE selected items from kernel state (will be updated via fe_drag_info)
                unifiedDrag={kind:"fe",srcWinId:win.id,entryIdx:vi,srcPath:"",
                    label:"…",icon:"📄",startX:mx,startY:my,curX:mx,curY:my,active:false,feSelCount:1};
                window.alphaOS.sendEvent({type:"fe_drag_info",winId:win.id,entryIdx:vi});
            }
        }        return;
    }
    // Desktop area — select/drag desktop file icons
    if(e.button===0){
        const dw=windows.find(w=>w.title==="__desktop__");
        if(dw){
            const PAD=16,IW=72,IH=72,SLOT=100;
            let hitIdx=-1;
            for(let i=0;i<20;i++){
                const col=Math.floor(i/8),row=i%8;
                const ix=PAD+col*(IW+20),iy=PAD+row*SLOT;
                if(mx>=ix&&mx<=ix+IW&&my>=iy&&my<=iy+IH+20){hitIdx=i;break;}
            }
            if(hitIdx>=0){
                // Always send select (handles ctrl/shift and single→open logic)
                window.alphaOS.sendEvent({type:"desktop_select",x:Math.round(mx),y:Math.round(my),ctrl:e.ctrlKey,shift:e.shiftKey});
                // Also start drag tracking
                unifiedDrag={kind:"desktop",srcWinId:-1,entryIdx:hitIdx,srcPath:"",
                    label:"…",icon:"📄",startX:mx,startY:my,curX:mx,curY:my,active:false,iconIdx:hitIdx,selectedCount:1};
                window.alphaOS.sendEvent({type:"desktop_drag_info",entryIdx:hitIdx});
            } else {
                // Click on empty desktop area → clear selection
                window.alphaOS.sendEvent({type:"desktop_select",x:Math.round(mx),y:Math.round(my),ctrl:e.ctrlKey,shift:e.shiftKey});
            }
        }
    }
});

canvasWrap.addEventListener("mousemove",e=>{
    updateMouse(e);const mx=cMouseX,my=cMouseY;
    // Launcher search field drag selection
    if(launcherOpen&&_launcherSearchDrag){
        const f=launcherField;
        if(f.selStart===null)f.selStart=f.cursor;
        const OW=520,ox=Math.round((displayW-OW)/2),oy=MENU_BAR_H+50;
        const textX=ox+20+35;
        const relX=Math.max(0,mx-textX);
        f.cursor=_xToCharIdx(f.value,relX,"400 14px 'A2G',system-ui");
        f.blink=Date.now();
        return;
    }
    if(unifiedDrag){
        unifiedDrag.curX=mx;unifiedDrag.curY=my;
        if(!unifiedDrag.active&&Math.hypot(mx-unifiedDrag.startX,my-unifiedDrag.startY)>8)
            unifiedDrag.active=true;
        if(unifiedDrag.active){canvasWrap.style.cursor="grabbing";return;}
        // Not yet active — also send to kernel so dialog input fields still receive mousemove
    }
    if(drag){
        const nx=Math.round(mx-drag.offX),ny=Math.round(my-drag.offY);
        const win=windows.find(w=>w.id===drag.winId);if(win){win.x=nx;win.y=ny;}
        window.alphaOS.sendEvent({type:"win_move",id:drag.winId,x:nx,y:ny});
        canvasWrap.style.cursor="grabbing";return;
    }
    if(resize){
        const{winId,edge,startMX,startMY,startX,startY,startW,startH}=resize;
        const dx=mx-startMX,dy=my-startMY;
        let nx=startX,ny=startY,nw=startW,nh=startH;
        if(edge.includes("e"))nw=Math.max(200,startW+dx);
        if(edge.includes("s"))nh=Math.max(120,startH+dy);
        if(edge.includes("w")){nw=Math.max(200,startW-dx);nx=startX+(startW-nw);}
        const win=windows.find(w=>w.id===winId);if(win){win.x=nx;win.y=ny;win.width=nw;win.height=nh;}
        window.alphaOS.sendEvent({type:"win_resize",id:winId,x:nx,y:ny,width:nw,height:nh});
        canvasWrap.style.cursor=EC[edge]||"default";return;
    }
    const win=winAt(mx,my);
    if(win&&win.decorations!==false){const e2=resizeEdge(win,mx,my);canvasWrap.style.cursor=e2?(EC[e2]||"default"):"none";}
    else canvasWrap.style.cursor="none";
    // Always send mousemove as absolute coords — kernel converts to local per focused window
    window.alphaOS.sendEvent({type:"input_event",event:{type:"mousemove",timestamp:Date.now(),data:{x:Math.round(mx),y:Math.round(my),button:0,buttons:e.buttons}}});
});

canvasWrap.addEventListener("mouseup",e=>{
    if(_launcherSearchDrag){
        _launcherSearchDrag=false;
        // Don't return — fall through so kernel gets mouseup too if needed
    }
    if(unifiedDrag){
        if(unifiedDrag.active){
            const dx=unifiedDrag.curX,dy=unifiedDrag.curY;
            const dropWin=winAt(dx,dy);
            if(dropWin&&dropWin.title&&dropWin.title.startsWith("Files")){
                const lx=dx-dropWin.x,ly=dy-dropWin.y;
                const SB=120,HDR=36,ROW=28,STA=24;
                const rowStart=HDR+22;
                const vi=(lx>=SB&&ly>=rowStart&&ly<dropWin.height-STA)?Math.floor((ly-rowStart)/ROW):-1;
                window.alphaOS.sendEvent({type:"unified_drop",
                    srcKind:unifiedDrag.kind, srcWinId:unifiedDrag.srcWinId,
                    srcIdx:unifiedDrag.entryIdx, srcPath:unifiedDrag.srcPath,
                    toWinId:dropWin.id, dropRowVi:vi});
            } else if(!dropWin||dropWin.title==="__desktop__"){
                // Drop onto desktop background
                window.alphaOS.sendEvent({type:"unified_drop",
                    srcKind:unifiedDrag.kind, srcWinId:unifiedDrag.srcWinId,
                    srcIdx:unifiedDrag.entryIdx, srcPath:unifiedDrag.srcPath,
                    toWinId:-1, dropRowVi:-1});
            }
            // else: drop on non-FE window → ignore
        }
        unifiedDrag=null;canvasWrap.style.cursor="none";return;
    }
    drag=null;resize=null;canvasWrap.style.cursor="none";
    window.alphaOS.sendEvent({type:"input_event",event:{type:"mouseup",timestamp:Date.now(),data:{x:Math.round(cMouseX),y:Math.round(cMouseY),button:e.button,buttons:e.buttons}}});
});

canvasWrap.addEventListener("dblclick",e=>{
    updateMouse(e);const mx=cMouseX,my=cMouseY;
    // Desktop icon double-click → open (via desktop_select with dbl flag)
    if(!winAt(mx,my)){
        window.alphaOS.sendEvent({type:"desktop_dblclick",x:Math.round(mx),y:Math.round(my)});
        return;
    }
    const win=winAt(mx,my);if(!win||win.decorations===false)return;
    const o=outer(win);
    // Title bar double-click → maximize
    if(my>=o.y&&my<o.y+TITLE_H+BORDER){window.alphaOS.sendEvent({type:"win_maximize",id:win.id});return;}
    // FE content double-click → open item
    if(win.title&&win.title.startsWith("Files")){
        const lx=mx-win.x,ly=my-win.y;
        window.alphaOS.sendEvent({type:"input_event",event:{type:"mousedown",timestamp:Date.now(),
            data:{x:Math.round(lx),y:Math.round(ly),button:0,buttons:1,ctrl:false,shift:false,dbl:true}}});
    }
});

canvasWrap.addEventListener("wheel",e=>{
    e.preventDefault();
    window.alphaOS.sendEvent({type:"input_event",event:{type:"wheel",timestamp:Date.now(),data:{x:Math.round(cMouseX),y:Math.round(cMouseY),button:0,buttons:0,deltaX:e.deltaX,deltaY:e.deltaY}}});
},{passive:false});

canvasWrap.addEventListener("contextmenu",e=>{
    e.preventDefault();updateMouse(e);const mx=cMouseX,my=cMouseY;
    const icon=desktopIconAt(mx,my);
    if(icon&&icon.appId){
        ctxMenu={x:mx,y:my,items:[
            {label:icon.label,bold:true},{label:"---"},
            {label:"Open",action:()=>sendAppEvent(icon.appId)},
        ]};return;
    }
    const win=winAt(mx,my);
    if(win&&win.decorations!==false){
        const o=outer(win);
        // Title bar context menu
        if(my>=o.y&&my<o.y+TITLE_H+BORDER){
            ctxMenu={x:mx,y:my,items:[
                {label:win.title,bold:true},{label:"---"},
                {label:"Minimize",     action:()=>window.alphaOS.sendEvent({type:"win_minimize",id:win.id})},
                {label:win.state==="MAXIMIZED"?"Restore":"Maximize",action:()=>window.alphaOS.sendEvent({type:"win_maximize",id:win.id})},
                {label:"---"},
                {label:"Close",        action:()=>window.alphaOS.sendEvent({type:"win_close",id:win.id}),danger:true},
            ]};return;
        }
        // Content area — FE context menu
        if(win.title&&win.title.startsWith("Files")){
            const lx=Math.round(mx-win.x), ly=Math.round(my-win.y);
            window.alphaOS.sendEvent({type:"fe_context_menu",winId:win.id,x:mx,y:my,lx,ly});
            return;
        }
        // Text editor context menu
        const t=win.title||"";
        if(win.drawCommands&&win.drawCommands.some&&win.drawCommands.some(cmd=>cmd&&cmd.text&&cmd.text.includes("^S"))){
            ctxMenu={x:mx,y:my,items:[
                {label:"Edit",bold:true},{label:"---"},
                {label:"New File",   action:()=>window.alphaOS.sendEvent({type:"editor_action",action:"new",winId:win.id})},
                {label:"Save",       action:()=>window.alphaOS.sendEvent({type:"editor_action",action:"save",winId:win.id})},
                {label:"Save As…",   action:()=>window.alphaOS.sendEvent({type:"editor_action",action:"saveAs",winId:win.id})},
                {label:"---"},
                {label:"Select All", action:()=>window.alphaOS.sendEvent({type:"editor_action",action:"selectAll",winId:win.id})},
                {label:"Copy",       action:()=>window.alphaOS.sendEvent({type:"editor_action",action:"copy",winId:win.id})},
                {label:"Paste",      action:()=>window.alphaOS.sendEvent({type:"editor_action",action:"paste",winId:win.id})},
                {label:"---"},
                {label:"Close",      action:()=>window.alphaOS.sendEvent({type:"win_close",id:win.id}),danger:true},
            ]};return;
        }
        void t;
    }
    if(!win){
        window.alphaOS.sendEvent({type:"desktop_context_menu",x:mx,y:my});
    }
});

canvasWrap.style.cursor="none";
canvasWrap.addEventListener("mouseenter",()=>{canvasWrap.style.cursor="none";});
canvasWrap.addEventListener("keydown",e=>{
    e.preventDefault();
    // Launcher: Cmd/Ctrl+Space to toggle, Escape/keys handled internally
    if((e.metaKey||e.ctrlKey)&&e.code==="Space"){
        launcherOpen=!launcherOpen;
        launcherField={value:"",cursor:0,selStart:null,blink:Date.now(),_lastClick:0,_lastClickPos:-1};
        return;
    }
    if(_launcherKey(e))return;
    // Delete key: if no window focused but desktop visible, delete selected desktop items
    if((e.key==="Delete"||e.key==="Backspace")&&!focusedId){
        window.alphaOS.sendEvent({type:"desktop_delete_selected"});
        return;
    }
    window.alphaOS.sendEvent({type:"input_event",event:{type:"keydown",timestamp:Date.now(),data:{key:e.key,code:e.code,ctrl:e.ctrlKey,shift:e.shiftKey,alt:e.altKey,meta:e.metaKey,repeat:e.repeat}}});
});
canvasWrap.addEventListener("keyup",e=>{
    window.alphaOS.sendEvent({type:"input_event",event:{type:"keyup",timestamp:Date.now(),data:{key:e.key,code:e.code,ctrl:e.ctrlKey,shift:e.shiftKey,alt:e.altKey,meta:e.metaKey,repeat:false}}});
});
canvasWrap.focus();
document.getElementById("btn-close").addEventListener("click",()=>window.alphaOS.sendWindowAction("close"));
document.getElementById("btn-min"  ).addEventListener("click",()=>window.alphaOS.sendWindowAction("minimize"));
document.getElementById("btn-max"  ).addEventListener("click",()=>window.alphaOS.sendWindowAction("maximize"));
