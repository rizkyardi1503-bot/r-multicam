/* Independent local scoring, labeling and benchmark interface. No bundled trained model. */
(function(root){
'use strict';
var names=['energy_jump','low_jump','bass_jump','mid_jump','high_jump','flux_jump','impact_score','build_rise','spectral_shift','energy_sustain','bass_sustain','rhythm_jump','breakdown_depth','structural_novelty','pre_break_depth','buildup_slope'];
var active=null;
function finite(x){return typeof x==='number'&&isFinite(x);}
function validate(model){
 if(!model||model.schema!=='rp-drop-logistic-v1'||JSON.stringify(model.features)!==JSON.stringify(names))throw Error('Unsupported model schema/features');
 if(!Array.isArray(model.weights)||!Array.isArray(model.mean)||!Array.isArray(model.scale)||model.weights.length!==names.length||model.mean.length!==names.length||model.scale.length!==names.length)throw Error('Invalid model dimensions');
 if(!finite(model.bias)||model.weights.some(function(x){return !finite(x);})||model.mean.some(function(x){return !finite(x);})||model.scale.some(function(x){return !finite(x)||x<=0;}))throw Error('Invalid model values');
 if(!model.training||model.training.positive<1||model.training.negative<1||model.training.songs<3)throw Error('Model requires labeled positive/negative examples from at least three songs');
 return JSON.parse(JSON.stringify(model));
}
function probability(row,model){var z=model.bias;for(var i=0;i<names.length;i++){var v=Number(row[names[i]])||0;z+=model.weights[i]*Math.max(-8,Math.min(8,(v-model.mean[i])/model.scale[i]));}return 1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));}
function apply(rows){return rows.map(function(c){var x=Object.assign({},c);x.model_status=active?'trained-local':'rules-only';if(active){x.local_confidence_score=x.confidence_score;x.model_probability=probability(x,active);x.confidence_score=Math.round(.75*x.confidence_score+.25*x.model_probability*100);}return x;});}
function dataset(result,song){var map=result.musicV12||{},range=result.snapshot&&result.snapshot.range;return {schema:'rp-drop-labels-v1',song_id:String(song||''),duration:result.snapshot&&result.snapshot.duration||0,range:range||null,bpm:result.tempo||result.bpm||null,reference_drops:[],reference_beats:[],reference_bpm:null,dropfinder_drops:null,rows:(map.ranked_drops||[]).map(function(c){var row={time:c.time,label:null};names.forEach(function(k){row[k]=Number(c[k])||0;});return row;}),engine_drops:(map.events||[]).map(function(e){return e.drop_time;}),engine_beats:(result.beats||[]).map(function(x){return typeof x==='object'?x.time:x;})};}
function compare(predicted,reference,tolerance){
 tolerance=tolerance==null?.15:Number(tolerance);if(!isFinite(tolerance)||tolerance<0)throw Error('Invalid tolerance');
 var p=predicted.slice().sort(function(a,b){return a-b;}),r=reference.slice().sort(function(a,b){return a-b;}),used={},errors=[];
 if(p.concat(r).some(function(x){return !finite(x)||x<0;}))throw Error('Invalid timestamp');
 // Earliest compatible matching yields maximum cardinality for sorted points.
 var a=0,b=0;while(a<p.length&&b<r.length){if(p[a]<r[b]-tolerance)a++;else if(p[a]>r[b]+tolerance)b++;else{used[a]=true;errors.push(p[a]-r[b]);a++;b++;}}
 var tp=errors.length,precision=p.length?tp/p.length:null,recall=r.length?tp/r.length:null;
 return {true_positive:tp,false_positive:p.length-tp,false_negative:r.length-tp,precision:precision,recall:recall,f1:precision!=null&&recall!=null?(precision+recall?2*precision*recall/(precision+recall):0):null,mean_absolute_timing_error:tp?errors.reduce(function(s,x){return s+Math.abs(x);},0)/tp:null,tolerance_seconds:tolerance};
}
function restore(){try{var saved=root.localStorage&&root.localStorage.getItem('rp.drop.model.v1');if(saved)active=validate(JSON.parse(saved));}catch(e){active=null;}}
var api={features:names,validate:validate,probability:probability,apply:apply,dataset:dataset,compare:compare,status:function(){return {mode:active?'trained-local':'rules-only',training:active&&active.training||null};},setModel:function(m){var next=validate(m);if(root.localStorage)root.localStorage.setItem('rp.drop.model.v1',JSON.stringify(next));active=next;},clearModel:function(){if(root.localStorage)root.localStorage.removeItem('rp.drop.model.v1');active=null;}};
restore();root.RPMusicLearning=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
}(typeof window!=='undefined'?window:globalThis));
