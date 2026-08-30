(function(){
  'use strict';
  var MM_VERSION='1.3.1';
  var MM_EQ_FREQUENCIES=[31,62,125,250,500,1000,2000,4000,8000,16000];
  window.openPropagationMap=function(){
    var mapWindow=window.open('https://vhf.dxview.org/map?center=47.19,10.12,6.3','openwebrx-propagation','popup=yes,width=1200,height=800,resizable=yes,scrollbars=yes');
    if(mapWindow)mapWindow.focus();
  };
  var webcamTimer=null;
  function refreshWebcam(){
    var image=q('#mm-webcam-image'),status=q('#mm-webcam-status');
    if(!image)return;
    if(status)status.textContent='UPDATING…';
    image.src='https://www.freewaves.it/camimagnacam.jpg?t='+Date.now();
  }
  window.closeWebcam=function(){
    var panel=q('#mm-webcam-panel'),button=q('#mm-webcam-button');
    if(panel)panel.style.display='none';
    if(button)button.classList.remove('mm-active');
    if(webcamTimer){clearInterval(webcamTimer);webcamTimer=null}
    updateDock();
  };
  window.openWebcam=function(){
    var host=q('#openwebrx-panels-container-left'),panel=q('#mm-webcam-panel'),button=q('#mm-webcam-button');
    if(!host||!panel)return;
    if(panel.style.display==='block'){window.closeWebcam();return}
    if(!panel.dataset.mmWebcamBound){
      panel.dataset.mmWebcamBound='1';
      var image=q('#mm-webcam-image',panel),status=q('#mm-webcam-status',panel);
      image.onload=function(){status.textContent='UPDATED · '+new Date().toLocaleTimeString()};
      image.onerror=function(){status.textContent='IMAGE UNAVAILABLE · RETRY IN 60 SEC'};
    }
    panel.style.display='block';
    if(button)button.classList.add('mm-active');
    refreshWebcam();
    if(webcamTimer)clearInterval(webcamTimer);
    webcamTimer=setInterval(refreshWebcam,60000);
    updateDock();
  };
  function q(s,r){return (r||document).querySelector(s)}
  function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
  function make(tag,id,cls){var e=document.createElement(tag);if(id)e.id=id;if(cls)e.className=cls;return e}

  function retitle(){
    document.title='Max Mountain Station | Tactical SDR Console';
    var t=q('.webrx-rx-title'); if(t)t.textContent="MAX'S MOUNTAINS STATION VHF - UHF";
  }

  function addInterfaceFooter(){
    if(q('#mm-interface-footer'))return;
    var page=q('#webrx-page-container');if(!page)return;
    var footer=make('footer','mm-interface-footer');
    footer.innerHTML='<span>MAX\'S MOUNTAIN STATION — TACTICAL INTERFACE v'+MM_VERSION+'</span><span class="mm-footer-separator">•</span><a href="https://www.freewaves.it/" target="_blank" rel="noopener noreferrer">www.freewaves.it</a><span class="mm-footer-separator">•</span><span>ALL RIGHTS RESERVED © 2026</span>';
    page.appendChild(footer);
  }

  function buildWorkspace(){
    if(q('#mm-workspace'))return true;
    var page=q('#webrx-page-container'), waterfall=q('.openwebrx-waterfall-container');
    var left=q('#openwebrx-panels-container-left'), right=q('#openwebrx-panels-container-right');
    if(!page||!waterfall||!left||!right)return false;
    var ws=make('main','mm-workspace'), main=make('section','mm-main-column'), spec=make('section','mm-spectrum-slot');
    var dock=make('section','mm-decoder-dock'), side=make('aside','mm-sidebar');
    var sh=make('div','mm-sidebar-head');sh.innerHTML='<span>RX CONTROL DECK</span><span id="mm-utc-clock">--:--:-- UTC</span>';
    var scroll=make('div','mm-sidebar-scroll');
    page.appendChild(ws);ws.appendChild(main);ws.appendChild(side);main.appendChild(spec);main.appendChild(dock);side.appendChild(sh);side.appendChild(scroll);addInterfaceFooter();
    spec.appendChild(waterfall);dock.appendChild(left);scroll.appendChild(right);
    updateDock();
    new MutationObserver(updateDock).observe(left,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class']});
    return true;
  }

  function panelOpen(el){
    var s=el.style,t=s.transform||'';
    if(s.display==='none'||s.visibility==='hidden'||t.indexOf('rotateX(90deg)')!==-1)return false;
    if((el.id==='openwebrx-panel-log'||el.id==='openwebrx-panel-status')&&t.indexOf('rotateX(0deg)')===-1)return false;
    return true;
  }
  function updateDock(){
    var d=q('#mm-decoder-dock'),l=q('#openwebrx-panels-container-left'),main=q('#mm-main-column');
    if(!d||!l)return;
    var panels=qa(':scope > .openwebrx-panel, :scope > .mm-dock-panel',l);
    panels.forEach(function(el){el.classList.toggle('mm-dock-collapsed',!panelOpen(el))});
    var visiblePanels=panels.filter(panelOpen),any=visiblePanels.length>0;
    d.classList.toggle('mm-empty',!any);
    d.classList.toggle('mm-single-panel',visiblePanels.length===1);
    if(main)main.classList.toggle('mm-dock-active',any);
  }

  function ensureReceiver(){
    var p=q('#openwebrx-panel-receiver');
    if(!p)return;
    p.style.setProperty('display','block','important');p.style.setProperty('visibility','visible','important');
    p.style.setProperty('transform','none','important');p.style.setProperty('height','auto','important');p.movement='expand';
    var right=q('#openwebrx-panels-container-right');
    if(right && p.parentNode!==right)right.insertBefore(p,right.firstChild);
    var toggle=q('[data-toggle-panel="openwebrx-panel-receiver"]');
    if(toggle&&!toggle.dataset.mmLockedOpen){
      toggle.dataset.mmLockedOpen='1';toggle.setAttribute('aria-disabled','true');toggle.title='RX Control Deck sempre aperto';
      toggle.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();ensureReceiver()},true);
    }
  }

  function placeNativeSettings(){
    var buttons=q('.openwebrx-main-buttons');
    var settings=qa('a.button').find(function(a){return (a.textContent||'').trim()==='Settings'&&/settings(?:$|[?#])/i.test(a.getAttribute('href')||'')});
    if(!buttons||!settings)return;
    settings.classList.remove('mm-top-settings');
    if(settings.parentNode!==buttons)buttons.appendChild(settings);
  }

  function moveNativeSignalModule(){
    var receiver=q('#openwebrx-panel-receiver');
    var meter=q('#openwebrx-smeter'),db=q('#openwebrx-smeter-db');
    if(!receiver||!meter||!db)return false;
    var module=q('#mm-signal-module');
    if(!module){
      module=make('section','mm-signal-module');
      module.innerHTML='<div class="mm-sig-head"><span>RF SIGNAL LEVEL</span></div><div class="mm-native-smeter"></div><div class="mm-sig-scale"><span>S1</span><span>S3</span><span>S5</span><span>S7</span><span>S9</span><span>+40</span></div>';
      var profile=q('#openwebrx-sdr-profiles-listbox',receiver);
      var profileRow=profile&&profile.parentElement;
      if(profileRow&&profileRow.nextSibling)receiver.insertBefore(module,profileRow.nextSibling);else receiver.appendChild(module);
    }
    var nativeSlot=q('.mm-native-smeter',module);
    if(meter.parentNode!==nativeSlot)nativeSlot.appendChild(meter);
    if(db.parentNode!==q('.mm-sig-head',module))q('.mm-sig-head',module).appendChild(db);
    return true;
  }

  function installAudioTap(){
    if(window.__mmAudioTapInstalled)return;
    window.__mmAudioTapInstalled=true;
    window.__mmAudioSources=[];window.__mmEqualizers=[];
    if(!window.AudioNode||!AudioNode.prototype.connect)return;
    var nativeConnect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(destination){
      if(this.__mmBypassEq)return nativeConnect.apply(this,arguments);
      try{
        if(this.context&&destination===this.context.destination){
          var context=this.context,filters=MM_EQ_FREQUENCIES.map(function(freq){
            var filter=context.createBiquadFilter();filter.type='peaking';filter.frequency.value=freq;filter.Q.value=1.35;filter.gain.value=0;return filter;
          });
          nativeConnect.call(this,filters[0]);
          for(var i=0;i<filters.length-1;i++)nativeConnect.call(filters[i],filters[i+1]);
          nativeConnect.call(filters[filters.length-1],destination);
          window.__mmEqualizers.push({source:this,filters:filters});
          if(window.__mmAudioSources.indexOf(this)<0)window.__mmAudioSources.push(this);
          window.dispatchEvent(new CustomEvent('mm-audio-source',{detail:{source:this,filters:filters}}));
          return destination;
        }
      }catch(e){}
      return nativeConnect.apply(this,arguments);
    };
  }

  function addAudioEqualizer(){
    var module=q('#mm-audio-module');if(!module||q('#mm-audio-eq'))return;
    var eq=make('section','mm-audio-eq'),head=make('div','mm-eq-head'),canvas=make('canvas','mm-eq-graph');
    canvas.width=700;canvas.height=170;canvas.tabIndex=0;canvas.setAttribute('aria-label','10 band equalizer: drag points vertically to adjust gain');
    head.innerHTML='<span>10-BAND EQ</span><span id="mm-eq-readout">SELECT A BAND</span><button type="button" id="mm-eq-reset">FLAT</button>';eq.appendChild(head);eq.appendChild(canvas);module.appendChild(eq);
    var saved=[];try{saved=JSON.parse(localStorage.getItem('mm-eq-gains')||'[]')}catch(e){}
    var gains=MM_EQ_FREQUENCIES.map(function(freq,index){return isFinite(saved[index])?Math.max(-12,Math.min(12,saved[index])):0}),active=-1,dragging=false;
    var ctx=canvas.getContext('2d'),readout=q('#mm-eq-readout');
    function label(freq){return freq>=1000?(freq/1000)+'k':String(freq)}
    function applyBand(index,gain){(window.__mmEqualizers||[]).forEach(function(chain){if(chain.filters[index])chain.filters[index].gain.value=gain})}
    function px(index){return 25+index*(canvas.width-50)/(MM_EQ_FREQUENCIES.length-1)}
    function py(gain){return 12+(12-gain)*(canvas.height-40)/24}
    function draw(){
      var w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);ctx.fillStyle='#020604';ctx.fillRect(0,0,w,h);
      ctx.lineWidth=1;ctx.strokeStyle='rgba(91,160,104,.18)';[-12,-6,0,6,12].forEach(function(g){var y=py(g);ctx.beginPath();ctx.moveTo(18,y);ctx.lineTo(w-18,y);ctx.stroke()});
      ctx.strokeStyle='#294e31';MM_EQ_FREQUENCIES.forEach(function(freq,i){var x=px(i);ctx.beginPath();ctx.moveTo(x,10);ctx.lineTo(x,h-25);ctx.stroke()});
      ctx.beginPath();gains.forEach(function(g,i){var x=px(i),y=py(g);if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)});ctx.strokeStyle='#91ff9d';ctx.lineWidth=3;ctx.shadowColor='rgba(145,255,157,.45)';ctx.shadowBlur=6;ctx.stroke();ctx.shadowBlur=0;
      ctx.font='13px "Roboto Mono",monospace';ctx.textAlign='center';ctx.textBaseline='middle';
      gains.forEach(function(g,i){var x=px(i),y=py(g);ctx.beginPath();ctx.arc(x,y,i===active?8:6,0,Math.PI*2);ctx.fillStyle=i===active?'#fff5a6':'#91ff9d';ctx.fill();ctx.fillStyle='#789681';ctx.fillText(label(MM_EQ_FREQUENCIES[i]),x,h-11)});
    }
    function save(){localStorage.setItem('mm-eq-gains',JSON.stringify(gains))}
    function applyAll(){gains.forEach(function(gain,index){applyBand(index,gain)});draw()}
    function update(e){var r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*canvas.width/r.width,y=(e.clientY-r.top)*canvas.height/r.height;active=Math.max(0,Math.min(9,Math.round((x-25)/(canvas.width-50)*9)));gains[active]=Math.max(-12,Math.min(12,Math.round((12-(y-12)*24/(canvas.height-40))*2)/2));applyBand(active,gains[active]);save();readout.textContent=label(MM_EQ_FREQUENCIES[active])+' Hz  '+(gains[active]>0?'+':'')+gains[active].toFixed(1)+' dB';draw()}
    canvas.addEventListener('pointerdown',function(e){dragging=true;canvas.setPointerCapture(e.pointerId);update(e)});canvas.addEventListener('pointermove',function(e){if(dragging)update(e)});canvas.addEventListener('pointerup',function(){dragging=false});canvas.addEventListener('pointercancel',function(){dragging=false});
    canvas.addEventListener('keydown',function(e){if(active<0)active=0;if(e.key==='ArrowLeft')active=Math.max(0,active-1);else if(e.key==='ArrowRight')active=Math.min(9,active+1);else if(e.key==='ArrowUp')gains[active]=Math.min(12,gains[active]+.5);else if(e.key==='ArrowDown')gains[active]=Math.max(-12,gains[active]-.5);else return;e.preventDefault();applyBand(active,gains[active]);save();readout.textContent=label(MM_EQ_FREQUENCIES[active])+' Hz  '+(gains[active]>0?'+':'')+gains[active].toFixed(1)+' dB';draw()});
    q('#mm-eq-reset').addEventListener('click',function(){gains=gains.map(function(){return 0});active=-1;readout.textContent='FLAT 0 dB';save();applyAll()});
    window.addEventListener('mm-audio-source',applyAll);applyAll();
  }

  function addAudioAnalyzer(){
    var receiver=q('#openwebrx-panel-receiver');if(!receiver||q('#mm-audio-module'))return;
    var box=make('section','mm-audio-module');
    box.innerHTML='<div id="mm-audio-head"><span>AUDIO SPECTRUM ANALYZER</span><span id="mm-audio-state">WAITING AUDIO</span></div><canvas id="mm-audio-canvas" width="700" height="208"></canvas><div id="mm-audio-scale"><span>0</span><span>5 kHz</span><span>10 kHz</span><span>15 kHz</span><span>20 kHz</span></div>';
    var signal=q('#mm-signal-module');
    if(signal&&signal.nextSibling)receiver.insertBefore(box,signal.nextSibling);else receiver.appendChild(box);
    var canvas=q('#mm-audio-canvas'),ctx=canvas.getContext('2d'),analyser=null,data=null,connectedNode=null,silentGain=null;
    function connect(){
      if(analyser)return true;
      try{
        var sources=window.__mmAudioSources||[],node=null;
        /* Read the decoded signal before gainNode so the spectrum represents
           the station audio and does not move with volume or mute. */
        if(typeof audioEngine!=='undefined'&&audioEngine){
          node=audioEngine.audioNode;
          if(!node)return false;
        }else node=sources[sources.length-1];
        if(!node||!node.context)return false;
        analyser=node.context.createAnalyser();
        analyser.fftSize=2048;analyser.smoothingTimeConstant=.72;analyser.minDecibels=-105;analyser.maxDecibels=-15;
        silentGain=node.context.createGain();silentGain.gain.value=0;silentGain.__mmBypassEq=true;
        node.connect(analyser);analyser.connect(silentGain);silentGain.connect(node.context.destination);
        connectedNode=node;data=new Uint8Array(analyser.frequencyBinCount);return true;
      }catch(e){analyser=null;data=null;connectedNode=null}
      return false;
    }
    function draw(){
      requestAnimationFrame(draw);
      var w=canvas.width,h=canvas.height,state=q('#mm-audio-state');
      ctx.fillStyle='#020403';ctx.fillRect(0,0,w,h);
      ctx.strokeStyle='rgba(66,217,104,.12)';ctx.lineWidth=1;
      for(var gx=0;gx<=8;gx++){var x=gx*w/8;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}
      for(var gy=0;gy<=4;gy++){var y=gy*h/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
      if(!connect()){if(state)state.textContent='WAITING AUDIO';return}
      try{analyser.getByteFrequencyData(data)}catch(e){analyser=null;data=null;connectedNode=null;return}
      if(state)state.textContent=connectedNode.context.state==='running'?'LIVE':'CLICK AUDIO';
      ctx.beginPath();
      var hzPerBin=connectedNode.context.sampleRate/analyser.fftSize;
      var bins=Math.max(2,Math.min(data.length,Math.floor(20000/hzPerBin)+1));
      for(var i=0;i<bins;i++){var xx=i/(bins-1)*w,yy=h-(data[i]/255)*(h-8)-4;if(i===0)ctx.moveTo(xx,yy);else ctx.lineTo(xx,yy)}
      ctx.strokeStyle='#91ff9d';ctx.lineWidth=2;ctx.shadowColor='rgba(145,255,157,.45)';ctx.shadowBlur=5;ctx.stroke();ctx.shadowBlur=0;
    }
    draw();addAudioEqualizer();
  }

  function validOptions(select){
    return qa('option',select).filter(function(o){
      var v=(o.value||'').trim(),t=(o.textContent||'').trim();
      return !o.disabled && t && v!=='' && t!=='-';
    });
  }

  function triggerSelect(select,value){
    if(!select)return;
    select.value=value;
    select.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function nativeModeButton(host,value){
    return qa('.openwebrx-demodulator-button[data-modulation]',host).find(function(b){return String(b.dataset.modulation)===String(value)});
  }

  function buildModeButtons(){
    var host=q('#openwebrx-panel-receiver .openwebrx-modes');if(!host)return;
    var selects=qa('select',host).filter(function(s){return !s.classList.contains('mm-mode-proxy')});if(!selects.length)return;
    var signature=selects.map(function(s){return validOptions(s).map(function(o){return o.value+'='+o.textContent}).join('|')}).join('||');
    var groups=q('.mm-mode-groups',host);
    if(groups&&groups.dataset.signature===signature){syncModeButtons();return}
    if(groups)groups.remove();
    qa(':scope > *',host).forEach(function(e){if(!e.classList.contains('mm-mode-groups'))e.classList.add('mm-native-mode-control')});
    groups=make('div',null,'mm-mode-groups');groups.dataset.signature=signature;
    selects.slice(0,2).forEach(function(select,index){
      var group=make('div',null,'mm-mode-group'),label=make('div',null,'mm-mode-label'),keys=make('div',null,'mm-mode-keys');
      label.textContent=index===0?'ANALOG':'DIGITAL';
      var opts=validOptions(select);
      if(!opts.length)group.classList.add('mm-empty');
      opts.forEach(function(opt){
        var b=make('button',null,'mm-mode-key');b.type='button';b.textContent=(opt.textContent||opt.value).trim();b.dataset.value=opt.value;b.dataset.mmSelect=String(index);
        b.addEventListener('click',function(){
          function activate(value){var nativeButton=index===0&&nativeModeButton(host,value);if(nativeButton)nativeButton.click();else if(String(select.value)!==String(value))triggerSelect(select,value);setTimeout(syncModeButtons,25)}
          activate(opt.value);
        });
        keys.appendChild(b);
      });
      group.appendChild(label);group.appendChild(keys);groups.appendChild(group);
      select.addEventListener('change',syncModeButtons);
    });
    if(!host.__mmModeObserver){
      host.__mmModeObserver=new MutationObserver(syncModeButtons);
      host.__mmModeObserver.observe(host,{attributes:true,subtree:true,attributeFilter:['class','selected']});
    }
    host.appendChild(groups);syncModeButtons();
  }

  function syncModeButtons(){
    var host=q('#openwebrx-panel-receiver .openwebrx-modes');if(!host)return;
    var selects=qa('select',host).filter(function(s){return !s.classList.contains('mm-mode-proxy')});
    qa('.mm-mode-key',host).forEach(function(b){
      var index=parseInt(b.dataset.mmSelect,10),s=selects[index];
      var nativeButton=index===0&&nativeModeButton(host,b.dataset.value);
      var active=!!(nativeButton&&nativeButton.classList.contains('highlighted'))||!!s&&String(s.value)===String(b.dataset.value);
      b.classList.toggle('mm-active',active);
    });
  }

  function arrangeWaterfallRangeControls(){
    if(q('#mm-waterfall-range-row'))return;
    var auto=q('#openwebrx-waterfall-colors-auto'),min=q('#openwebrx-waterfall-color-min');
    var reset=q('#openwebrx-waterfall-colors-default'),max=q('#openwebrx-waterfall-color-max');
    if(!auto||!min||!reset||!max)return;
    var source=reset.closest('.openwebrx-panel-line'),section=source&&source.parentElement;if(!section)return;
    var row=make('div','mm-waterfall-range-row','openwebrx-panel-line');
    section.insertBefore(row,source);row.appendChild(auto);row.appendChild(min);row.appendChild(reset);row.appendChild(max);
  }

  function placeControlsBeforeModes(){
    var controls=q('#openwebrx-section-controls'),modes=q('#openwebrx-section-modes');
    if(!controls||!modes||controls.parentElement!==modes.parentElement)return;
    var controlsBody=controls.nextElementSibling;
    if(controls.compareDocumentPosition(modes)&Node.DOCUMENT_POSITION_FOLLOWING)return;
    modes.parentElement.insertBefore(controls,modes);
    if(controlsBody)modes.parentElement.insertBefore(controlsBody,modes);
  }

  function addFilterBandwidthControl(){
    var volume=q('#openwebrx-panel-volume');if(!volume||q('#mm-filter-bandwidth'))return;
    var nativeLine=volume.closest('.openwebrx-panel-line');if(!nativeLine)return;
    nativeLine.classList.add('mm-filter-host');
    var row=make('div','mm-filter-bandwidth');
    row.innerHTML='<button type="button" aria-expanded="false">FILTER BW</button><span class="mm-filter-popover"><span class="mm-filter-width"><input data-role="width" type="range" min="0" max="30" step="0.5" value="9" aria-label="Filter bandwidth"><b>9.0 kHz</b></span><span class="mm-filter-edges"><label>LOW<input data-role="low" type="range" step="0.1" aria-label="Low filter edge"><b>--</b></label><label>HIGH<input data-role="high" type="range" step="0.1" aria-label="High filter edge"><b>--</b></label></span></span>';
    nativeLine.insertBefore(row,volume.nextSibling);
    var button=q('button',row),slider=q('[data-role="width"]',row),value=q('.mm-filter-width b',row);
    var lowSlider=q('[data-role="low"]',row),highSlider=q('[data-role="high"]',row),lowValue=lowSlider.nextElementSibling,highValue=highSlider.nextElementSibling;
    button.addEventListener('click',function(e){e.stopPropagation();var open=row.classList.toggle('mm-open');button.setAttribute('aria-expanded',open?'true':'false')});
    document.addEventListener('click',function(e){if(!row.contains(e.target)){row.classList.remove('mm-open');button.setAttribute('aria-expanded','false')}});
    function supported(d){return d&&['am','sam','cquam','fm','nfm','data','usb','lsb','usbd','lsbd'].indexOf(d.get_modulation())>=0&&!d.get_secondary_demod()}
    function sideband(d){return d&&['usb','lsb','usbd','lsbd'].indexOf(d.get_modulation())>=0}
    function save(d,low,high){d.setBandpass({low_cut:low,high_cut:high});if(UI.saveBandpass)UI.saveBandpass(d.get_modulation(),low,high)}
    function apply(){
      var d=typeof UI!=='undefined'&&UI.getDemodulator?UI.getDemodulator():null;
      if(!supported(d))return sync();
      var khz=Math.max(0,Math.min(30,parseFloat(slider.value)||0));
      var width=Math.max(100,Math.round(khz*1000)),center=(d.low_cut+d.high_cut)/2;
      if(!isFinite(center))center=0;
      var half=width/2,low=center-half,high=center+half;
      if(low<d.filter.limits.low){high+=d.filter.limits.low-low;low=d.filter.limits.low}
      if(high>d.filter.limits.high){low-=high-d.filter.limits.high;high=d.filter.limits.high}
      save(d,low,high);
      value.textContent=(width/1000).toFixed(1)+' kHz';
    }
    function applyEdge(which){
      var d=typeof UI!=='undefined'&&UI.getDemodulator?UI.getDemodulator():null;if(!supported(d)||!sideband(d))return sync();
      var low=Math.round((parseFloat(lowSlider.value)||0)*1000),high=Math.round((parseFloat(highSlider.value)||0)*1000);
      if(which==='low')low=Math.min(low,high-100);else high=Math.max(high,low+100);
      low=Math.max(d.filter.limits.low,low);high=Math.min(d.filter.limits.high,high);save(d,low,high);sync();
    }
    function sync(){
      var d=typeof UI!=='undefined'&&UI.getDemodulator?UI.getDemodulator():null,ok=supported(d);
      var edges=ok&&sideband(d);slider.disabled=!ok;lowSlider.disabled=!edges;highSlider.disabled=!edges;row.classList.toggle('mm-disabled',!ok);row.classList.toggle('mm-sideband',edges);
      if(!ok){value.textContent='N/A';return}
      if(edges){
        lowSlider.min=highSlider.min=String(d.filter.limits.low/1000);lowSlider.max=highSlider.max=String(d.filter.limits.high/1000);
        lowSlider.value=String(d.low_cut/1000);highSlider.value=String(d.high_cut/1000);
        lowValue.textContent=(d.low_cut/1000).toFixed(1)+' kHz';highValue.textContent=(d.high_cut/1000).toFixed(1)+' kHz';return;
      }
      var width=Math.max(100,Math.min(30000,(d.high_cut||0)-(d.low_cut||0)));
      slider.value=String(width/1000);value.textContent=(width/1000).toFixed(1)+' kHz';
    }
    slider.addEventListener('input',apply);slider.addEventListener('change',apply);
    lowSlider.addEventListener('input',function(){applyEdge('low')});lowSlider.addEventListener('change',function(){applyEdge('low')});
    highSlider.addEventListener('input',function(){applyEdge('high')});highSlider.addEventListener('change',function(){applyEdge('high')});
    row.__mmSync=sync;sync();
  }

  function syncFilterBandwidthControl(){var row=q('#mm-filter-bandwidth');if(row&&row.__mmSync)row.__mmSync()}

  function polishControls(){
    qa('#openwebrx-panel-receiver .openwebrx-record-button').forEach(function(e){e.classList.add('mm-rec-control');e.setAttribute('aria-label','Record audio')});
    qa('#openwebrx-panel-receiver #screenshot-btn,#openwebrx-panel-receiver [title*="icture" i],#openwebrx-panel-receiver [title*="creenshot" i]').forEach(function(e){e.classList.add('mm-picture-control');e.setAttribute('aria-label','Picture')});
    qa('#openwebrx-panel-receiver [title="Open Scanner Controls"]').forEach(function(e){e.classList.add('mm-scanner-control');e.textContent='SCANNER'});
  }

  function syncRecordingButton(){
    var recording=typeof audioEngine!=='undefined'&&audioEngine&&audioEngine.recording===true;
    qa('#openwebrx-panel-receiver .openwebrx-record-button').forEach(function(button){
      button.classList.toggle('mm-recording-active',recording);
    });
  }

  function ensureSpectrum(){
    var container=q('.openwebrx-spectrum-container');
    if(!container||container.dataset.mmOpened)return;
    container.dataset.mmOpened='1';
    if(!container.classList.contains('expanded')){
      var toggle=q('#openwebrx-panel-receiver [title="Toggle spectrum display"]');
      if(toggle)toggle.click();
    }
  }

  function addSpectrumHeightControl(){
    var slot=q('#mm-spectrum-slot'),container=q('.openwebrx-spectrum-container');
    if(!slot||!container||q('#mm-spectrum-height-control'))return;
    var control=make('label','mm-spectrum-height-control');
    control.title='Regola altezza RF spectrum';
    control.innerHTML='<span>RF</span><input type="range" min="60" max="220" step="4" aria-label="RF spectrum height">';
    var slider=q('input',control),saved=parseInt(localStorage.getItem('mm-spectrum-height')||'96',10);
    if(!isFinite(saved))saved=96;
    saved=Math.max(60,Math.min(220,saved));slider.value=String(saved);
    function apply(){document.documentElement.style.setProperty('--mm-rf-spectrum-height',slider.value+'px');localStorage.setItem('mm-spectrum-height',slider.value)}
    slider.addEventListener('input',apply);apply();slot.appendChild(control);
  }

  function clock(){var e=q('#mm-utc-clock');if(e)e.textContent=new Date().toISOString().slice(11,19)+' UTC'}
  function applySmallFixes(){placeControlsBeforeModes();addFilterBandwidthControl();syncFilterBandwidthControl();addInterfaceFooter();ensureReceiver();placeNativeSettings();moveNativeSignalModule();buildModeButtons();arrangeWaterfallRangeControls();polishControls();ensureSpectrum();addSpectrumHeightControl();syncRecordingButton();addAudioEqualizer()}
  function init(){
    installAudioTap();retitle();document.body.classList.add('mm-console-v4');
    setTimeout(addFilterBandwidthControl,0);
    var tries=0,t=setInterval(function(){
      tries++;
      if(buildWorkspace()||tries>50){
        clearInterval(t);ensureReceiver();moveNativeSignalModule();addAudioAnalyzer();applySmallFixes();
      }
    },100);
    clock();setInterval(clock,1000);setInterval(function(){retitle();applySmallFixes()},1500);setInterval(syncRecordingButton,150);
    var pending=false;
    new MutationObserver(function(list){
      var added=list.some(function(m){return m.addedNodes&&m.addedNodes.length});
      if(added&&!pending){pending=true;setTimeout(function(){pending=false;applySmallFixes()},80)}
    }).observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
