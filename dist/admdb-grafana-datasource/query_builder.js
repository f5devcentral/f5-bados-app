/**
 * Created by kruman on 22/12/2015.
 */

define([
    'lodash',
    'app/core/utils/datemath',
],
function (_, dateMath) {
    'use strict';

    function AdmQueryBuilder(target, options) {
        this.target = target;
        this.options = options

        if (target.groupByTags) {
            target.groupBy = [{type: 'time', interval: 'auto'}];
            for (var i in target.groupByTags) {
                target.groupBy.push({type: 'tag', key: target.groupByTags[i]});
            }
            delete target.groupByTags;
        }
    }

    var p = AdmQueryBuilder.prototype;

    AdmQueryBuilder.prototype.fixedEncodeURIComponent = function(s) {
        if(!s)return s;

        return s.replace(/./g, function (c) {
            var i = c.charCodeAt(0);
            if(('a'<=c && c<='z') || 
                ('A'<=c && c<='Z') ||
                ('0'<=c && c<='9'))
                return c;
            if(c === '_') 
                return '__';
            return '_'+ i.toString(16);
        });
    };

    // templateSrv if specified will replace $a, .. vars from templates in query, what scopedVars for, no idea for now
    p.build = function(templateSrv, scopedVars) {
        try{
            var query = this.target.query;
            
            query = JSON.parse(query);
            if(templateSrv){
                query = _.forEach(query, function(v,k,arr){
                    if(k != "metric_regex" && k != 'vs_regex' && _.isString(v)) {
                        arr[k] = templateSrv.replace(v, scopedVars);
                    }
                })
            }
            if("vs" in query) {
                query.vs = AdmQueryBuilder.prototype.fixedEncodeURIComponent(query.vs);
            }
            if("topic" in query) {
                query.topic = AdmQueryBuilder.prototype.fixedEncodeURIComponent(query.topic);
            }
            
            if("metric_regex" in query) { // overrides metric
                query.metric = "*"
                query.metric_regex = new RegExp(query.metric_regex)
            }

            if("vs_regex" in query) { // overrides vs
                query.vs = "*"
                query.vs_regex = new RegExp(query.vs_regex)
            }
            
            if(query.geotable !== undefined && query.precision === undefined) {
                query.precision = "default"
            }

            if(query.precision === undefined && this.options !== undefined) {
                //console.log(["asdf",this.options])
                var from = dateMath.parse(this.options.range.from).valueOf();
                var to = dateMath.parse(this.options.range.to).valueOf();
                var span_sec = (to - from) / 1000; // in seconds
                if((this.options.intervalMs!==undefined && this.options.intervalMs <= 1000) || span_sec <= 5*60)
                    query.precision = 1000
                else if((this.options.intervalMs!==undefined && this.options.intervalMs <= 8000) || span_sec <= 5*60*8) 
                    query.precision = 8000
                else
                    query.precision = 64000
            }
            if(query.tpms !== undefined) {
                //console.log(query)
                [query.topic, query.metric] = query.tpms.split('.')
                //console.log(query)
            }
            query.alias = this.target.alias
            
            return query;
        }catch(e) {
            return {}
        }

    };

    return AdmQueryBuilder;
});