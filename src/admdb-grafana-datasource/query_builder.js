/**
 * Created by kruman on 22/12/2015.
 */

define([
        'lodash'
    ],
    function (_) {
        'use strict';

        function AdmQueryBuilder(target) {
            this.target = target;

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
                if((48<=i && i<=57) ||
                    (65<=i && i<=90) ||
                    (97<=i && i<=122) ||
                    c==='-' || c==='_' || c===".") {
                    return "_" + c;
                }
                return i.toString(16);});
        };

        // templateSrv if specified will replace $a, .. vars from templates in query, what scopedVars for, no idea for now
        p.build = function(templateSrv, scopedVars) {
            try{
                var query = this.target.query;
                if(templateSrv){
                    query = templateSrv.replace(query, scopedVars);
                }
                query = JSON.parse(query);
                if("vs" in query) {
                    query.vs = AdmQueryBuilder.prototype.fixedEncodeURIComponent(query.vs);
                }
                if("metric_regex" in query) {
                    query.metric = "*"
                    query.metric_regex = RegExp(query.metric_regex)
                }
                return query;
            }catch(e) {
                return {}
            }

        };

        return AdmQueryBuilder;
    });