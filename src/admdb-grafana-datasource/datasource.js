define([
  'angular',
  'lodash',
  'app/core/utils/datemath',
  './query_builder',
  './geohash',
  './data/countries',
  './data/states',
  './query_ctrl',
],
function (angular, _, dateMath, AdmQueryBuilder, geohash, countries, states) {
  'use strict';

  var self; // TBD: remove this, it allows probably one correctly working instance of datasource

  function AdmDbDatasource(instanceSettings, $q, backendSrv, templateSrv) {
    console.log(instanceSettings);
    console.log(arguments);
    this.type = 'grafana-admdb-evergreen-datasource';
    this.url = instanceSettings.url;
    this.database = instanceSettings.jsonData.database
    this.name = instanceSettings.name;
    this.base_path = '/shared/admdb'

    this.q = $q;
    this.backendSrv = backendSrv;
    this.templateSrv = templateSrv;
    this.States = states(); // function to query for state names, and get {lat,lon}
    this.Countries = countries(); // function to query for country names, and get {lat,lon}

    this.admdb_interface = { 
      permissions:'guest'/*guest|admin|guest,admin*/, 
      db_version:'v1'/*v2|v1*/
    };

    self = this;
  }

  AdmDbDatasource.prototype.ptPerFile = 4096; // points per file
  AdmDbDatasource.prototype.sRatesMs = _.map(_.range(3), function(x){return Math.pow(8,x)*1000}) // predefined, maybe later fetch it ; steps in ms between points in various precisions
  AdmDbDatasource.prototype.getSRate = function(sRate) { // return the min sample rate that is >= than sRate
      var x = this.sRatesMs;
      for(var i=0; i<x.length && sRate>x[i]; i++);
      if(i>=x.length) i = x.length - 1;
      return x[i] || x[0];
  }

  AdmDbDatasource.prototype.select_cols = function (m, col_names, select_cols) {
      // m - is a matrix, array of rows
      // col_names - array of m columns names
      // select_cols - array of columns to return in result matrix
      // returns permuted matrix, or null
      if(col_names === select_cols) return m; // identity check
      var itake = select_cols.map(function(v){return col_names.indexOf(v);}); // col indexes to take from m
      if(itake.indexOf(-1) >=0 ) return null;
      return m.map(function(row){return itake.map(function(i){return row[i];});});
  }

  // does the reverse of AdmQueryBuilder.prototype.fixedEncodeURIComponent
  AdmDbDatasource.prototype.fixedDecodeURIComponent = function(s) {
      if(!s || s.length%2 != 0) {
          return s;
      }

      return _.map(s.match(/.{2}/g), function(ss){
          if(ss[0]==="_") {
              return ss[1];
          }
          return String.fromCharCode(parseInt(ss, 16));
      }).join("");
  } 

    /* returns python code to be injected using rest-api
      example:
      base_path = '/shared/admdb',
      db = 'default'
      sRate = 1000
      tsfiles = ['1471354880000']  // can be more files
      ts = [1471355030000,1471355030000],
      metric_columns_aliases = [['sig.tps','*','']] // array of metric,columns, and aliases; [['sig.tps','*','TPS'],['sig.health',['v0','v1'],'HEALTH']]
    */
    AdmDbDatasource.prototype.table_query = function(base_path, db, sRate, tsfiles, ts, metric_columns_aliases) {
      var pcode = `
import os,json

def chch2a(chch):
    # convert 2 chars encode, to ascii char
    if chch[0]=='_':
        return chch[1]
    else:
        return chr(int(chch,16))

def fixedDecodeURIComponent(vs):
    # demangles encoded vs name
    return "".join([chch2a(vs[i:i+2]) for i in range(0, len(vs), 2)])
    
    
def vs_table_query(base_path='/shared/admdb',db='default'):
    # return list of virtual servers (not demangled) in db (except for 'all' component)
    return [x for x in os.listdir(os.path.join(base_path,db)) if x!='_a_l_l']

def cell_table_query(base_path,db,vs_raw,metric,sRate,columns,tsfiles,ts):
    #ts=(from,to)
    # returns {columns:[cola,colb],rows:[[a,b]]}
    for tsfile in reversed(tsfiles): # from last file
        try:
            with open(os.path.join(base_path,db,vs_raw,metric,str(sRate),str(tsfile)+'.txt'),'r') as f:
                try:
                    j=json.loads(f.read()+']}')
                    
                    cols = j['properties']['columns']
                    d=dict(zip(cols,range(len(cols))))
                    tcol=d['time']
                    if columns!="*":
                        #columns = json.loads(columns)
                        d=dict([(k,d[k]) for k in columns if k in d]) #col:idx
                    for v in reversed(j['values']):
                        if v[tcol]<=ts[1] and v[tcol]>=ts[0]:
                            return {'columns':d.keys(),'rows':[[v[i] for i in d.values()]]}
                except:
                    pass
        except:pass
    return {'columns':[], 'rows':[]}

def log(*args,**kargs):
    from datetime import datetime
    f = open('/var/run/adm/pylogs/1.txt','a')
    print >> f, datetime.now(), args, kargs
    f.close()

def dk(d,k): # return d[k] if k a valid key
    if d is not None and k in d:
        return d[k]
    return None

def table_query(base_path,db,sRate,tsfiles,ts,metric_columns_aliases):

    vs_raw_list = vs_table_query(base_path,db)
    vs_clean_list = [fixedDecodeURIComponent(x) for x in vs_raw_list]

    ret = { "columns": [{"text":"vs"}], "rows":[[vs] for vs in vs_clean_list], "type":"table" } # 

    for mca in metric_columns_aliases:
        column = {} # for 1 metric
        for vs,vs_raw in zip(vs_clean_list,vs_raw_list):
            r=cell_table_query(base_path,db,vs_raw,mca[0],sRate,mca[1],tsfiles,ts) # {columns:[cola,colb],rows:[[a,b]]}
            if len(r['rows']):
                column[vs]=dict(zip(r['columns'],r['rows'][0]))
        
        if len(column)==0:
            continue;
        col_names = list(set.union(*[set(d.keys()) for d in column.values()]))

        metric_name, b_add_col_name = mca[0], True
        if len(mca)>=3 and mca[2]!='':
            metric_name = mca[2]
            if len(col_names)<=1:
                b_add_col_name = False # alias, 1 column, then alias replaces the whole col name

        ret['columns']+=[{"text":metric_name+['', '.'+c][b_add_col_name]} for c in col_names]

        for ixrow, row in enumerate(ret["rows"]):
            ret["rows"][ixrow] += [dk(dk(column,row[0]),c) for c in col_names]
   
    return json.dumps(ret)

    `
    return pcode + 
`
print table_query('`+base_path+`','`+db+`',`+sRate+`,`+JSON.stringify(tsfiles)+`,`+JSON.stringify(ts)+`,`+JSON.stringify(metric_columns_aliases)+`)`;
    } 

  /* returns a function with cached results 
    @param fn - the function to wrap
    @param hash - by default key function results by fiorst argument only
    @param tout - timeout in ms, when data should be recalculated
    @param max_keys - triggers sweep on cache miss of all entries (still deleted by timestamps)
   */
  AdmDbDatasource.prototype.memoize = function(fn, hash=x=>x[0] ,tout=0, max_keys=2) {
    var cache = new Map();
    return function() {
        var e = arguments;
        var t =  Date.now()
        var hash_e = hash(...e)
        if(cache.has(hash_e)) {
            if(cache.get(hash_e).ts > t){
              console.log('using cache '+hash_e)
              return cache.get(hash_e).val
            }else{
              cache.delete(hash_e)
            }
        }
        if(cache.size >= max_keys) { // sweep cache
          cache.forEach(
            function(v,k){
              if(v.ts<=t){
                cache.delete(k)
              }
            }
          );
        }
        var res = fn.apply(this,e)
        cache.set(hash_e,{ts:t+tout, val:res})
        return res       
    }
  }

  AdmDbDatasource.prototype.datasourceRequest_raw = function() {
    return self.backendSrv.datasourceRequest(...arguments);
  }

  AdmDbDatasource.prototype.datasourceRequest1 =
    AdmDbDatasource.prototype.memoize(AdmDbDatasource.prototype.datasourceRequest_raw, function f(o){return JSON.stringify([o.method,o.url,o.data])}, 5000, 50); 

  /* supports data queries
  {"vs":"$vs", "metric":"$ms", "columns":"*"} - using predfined template vars, fetch all signals
  {"vs":"/Common/data", "metric":"threshold.hdrcachectrl", "columns":["v0"]} - specific virtual server, metric, and specific 1 signal
  {"vs":"/Common/data", "metric":"threshold.hdrcachectrl", "columns":["v0","v1"]} - like above, but fetch 2 bins
  {"vs":"$vs", "metric":"greylist.add", "columns":"*", "geotable":1 }  - this is for worldmap panel plugin; locationdata=table, labelfield=locationName
  {"vs":"$vs", "metric":"*", "columns":"*"} - specific virtual server, fetch all metrics and all signals for each of the metrics
  {"vs":"$vs", "metric_regex":"sig", "columns":"*"} - specific virtual server, fetch all metrics that pass regular expression and all signals for each of the metrics
 */
  AdmDbDatasource.prototype.query = function (options) {
    console.log(["query.options", options]);
    //console.log("Entering");
    //console.log(backendSrv);

    //return self.q.when({ data: [ { "columns": [{"text":"A"},{"text":"B"},{"text":"C"}], "rows":[["<a class ></a>",2,3],[4,5,6]], "type":"table" } ]});

    var bNoAggregation = false; // true if one of the queries requires no agreagtion, currently this implies that all will be considered as no agregation, and be sampled from the 1000 interval
    var bGeoTable = false; // if tag found in some query - we convert the results to be suitable for worldmap panel table iput with "Table Label Field"=locationName
    _.forEach(_.filter(options.targets, function (target) { return !target.hide }), function (target, series_id) {
      var query = new AdmQueryBuilder(target).build(self.templateSrv, options.scopedVars);
      if(query.geotable === 1) bGeoTable = true; 
      if(query.no_aggr === 1) bNoAggregation = true;
    });
    if(bGeoTable) bNoAggregation = true;
 
    var from = dateMath.parse(options.range.from).valueOf();
    var to = dateMath.parse(options.range.to).valueOf();
    var stepInMs = (to - from) / ((!bGeoTable && options.maxDataPoints) || 2000);
    var sRate = this.getSRate(stepInMs);
    if(bNoAggregation) sRate = 1000;

    var file_names = []
    for (var file_name = (from - (from % (this.ptPerFile * sRate)));
      file_name < to;
      file_name += (this.ptPerFile * sRate)) {
      file_names.push(file_name)
    }

    //console.log(["query range,files",from, to, file_names])

    var this_database = options.database || this.database;
    var _this = this;

    // check for table query, one of the queries should contain the table key, then the whole batch is treated as table query
    if(_.filter(options.targets, function (target) { return !target.hide && ('table' in JSON.parse(target.query)) }).length>0) {

      var metric_columns_aliases = []; // array of pairs of (metric, '*' or list of column names)  
      _.forEach(_.filter(options.targets, function (target) { return !target.hide }), function (target, series_id) {
        var query = new AdmQueryBuilder(target).build(self.templateSrv, options.scopedVars)
        metric_columns_aliases.push([query.metric, query.columns, target.alias]);
      })
      // extract metric : columns from each query, substitite them with template vars, and then call the below xuina 
      //console.log(metric_columns_aliases);

      var o = {
        method: 'POST',
        url: _this.url,
        params: '',
        data: { "command": "run", "utilCmdArgs": null},
        headers: { 'content-type': 'application/json' },
        inspect: { type: 'admdb' },
        precision: "ms"
      };

      if(_this.admdb_interface.permissions.indexOf('guest') >= 0 && _this.admdb_interface.db_version == 'v1'){
        o.url += '/mgmt/tm/util/admdb';
        let str_cmd = [_this.base_path, this_database, sRate, JSON.stringify(file_names), JSON.stringify([from,to]), JSON.stringify(metric_columns_aliases)].map(x=>"'"+x+"'").join(" ")
        o.data.utilCmdArgs = 'table-query '+str_cmd;
      } else if(_this.admdb_interface.permissions.indexOf('admin') >= 0 && _this.admdb_interface.db_version == 'v1'){
        o.url += '/mgmt/tm/util/bash';
        let str_b64 = btoa(_this.table_query(_this.base_path, this_database, sRate, file_names, [from,to], metric_columns_aliases)) //  [['sig.tps','["v0","time"]']]))
        o.data.utilCmdArgs = '-c "echo ' + str_b64 + `|python -c 'import base64; exec(base64.b64decode(raw_input()))' "`;
      } else {
        return self.q.when({ data:[]})
      }
      //console.log(o);
      return _this.datasourceRequest1(o).then(
        function(result){
          console.log(result);
          if (result.data.commandResult) {
            var data = result.data.commandResult;
            
            //console.log(data);
            return self.q.when({ data:[JSON.parse(data)]})
          }
        }
      )
    }



    // first make it work for 1 target
    var http_reqs = []
    //var series_id = 0 // unique id, to concat results returned for the same series, auto incremented by forEach
    _.forEach(_.filter(options.targets, function (target) { return !target.hide }), function (target, series_id) {
      //console.log(target)
      //console.log({"options.scopedVars":options.scopedVars})
      var query = new AdmQueryBuilder(target).build(self.templateSrv, options.scopedVars);
      if(query.geotable === 1) bGeoTable = true; 

      

      function gen_http_reqs(query, file_names, base_path, this_database, sRate, self, target, series_id){
        var http_reqs = []
        //console.log(["query",query])
        _.forEach(file_names, function (file_name) {
          var o = {
            method: 'POST',
            url: _this.url,
            params: '',
            data: { "command": "run", "utilCmdArgs": '' + [_this.base_path, this_database, query.vs, query.metric, sRate, file_name + '.txt'].join('/') + '"' },
            headers: { 'content-type': 'application/json' },
            inspect: { type: 'admdb' },
            precision: "ms"
          };

          if(_this.admdb_interface.permissions.indexOf('guest') >= 0 && _this.admdb_interface.db_version == 'v1'){
            o.url += '/mgmt/tm/util/admdb';
            o.data.utilCmdArgs = 'view-element "' + o.data.utilCmdArgs;
          } else if(_this.admdb_interface.permissions.indexOf('admin') >= 0 && _this.admdb_interface.db_version == 'v1'){
            o.url += '/mgmt/tm/util/bash';
            o.data.utilCmdArgs = '-c "cat ' + o.data.utilCmdArgs;
          } else {
            http_reqs.push(self.q.when({ series_id: series_id, data: {} }))
            return; // skip preparing an actual request to backend
          }

          console.log(["query.url", o.url, o.data.utilCmdArgs]);
          http_reqs.push(_this.datasourceRequest1(o).then(
            function (result) {
              if (result.data.commandResult) {
                var data = result.data.commandResult;


                if (data.length > 0 && data.indexOf("No such file or directory") === -1) { data += "]}"; }
                else { data = "{}" }
                //console.log(data);
                return self.q.when({ target: target, series_id: series_id, query: query, columns: query.columns, data: JSON.parse(data) })
              }
            },
            function (err) {
              return self.q.when({ series_id: series_id, data: {} })
            }
          ))
        })
        return http_reqs;
      }

      if(query.metric === "*") {
        http_reqs = http_reqs.concat(_this.metricFindQuery({"list_ms":1, "vs":query.vs, internal:1}).then(
          function(metrics){
            metrics = _.map(metrics, function(m) {return m.text})
            if(query.metric_regex) {
              console.log(query.metric_regex)
              metrics = _.filter(metrics, function(m){return query.metric_regex.test(m)});
            }
            //console.log("!!!",metrics)
            var http_reqs = []; // local requests resulting from above listing of metrics
            
            http_reqs = _.flatten(_.map(metrics, function(m, sub_ix) {
              var q = JSON.parse(JSON.stringify(query)); // fits because no functions defined in query
              q.metric = m;
              return gen_http_reqs(q, file_names, _this.base_path, this_database, sRate, self, target, series_id+'_'+sub_ix)
            } ));
            return self.q.all(http_reqs).then(function(results){ // TBD: not all, but all to fulfill
              return results;
            });
          }
        ))
      }else {
        http_reqs = http_reqs.concat(gen_http_reqs(query, file_names, _this.base_path, this_database, sRate, self, target, series_id));
      }
    })
    
    var p_all = self.q.all(http_reqs) // wait for all requests to complete, to fetch data

    return p_all.then(function (results) {
      //console.log(["p_all",results])
      var series = {}
      _.forEach(_.flatten(results), function (result) {
        //console.log(["p_all__",result])
        if ('data' in result && 'properties' in result.data && 'values' in result.data) {

          if (result.columns === "*") {
            var cols = _.filter(result.data.properties.columns, function (c) { return c !== "time" });

          } else {
            var cols = result.columns;
          }
          //console.log(["cols",cols]);

          for (var i = 0; i < cols.length; ++i)
            if (!([result.series_id, cols[i]] in series)) {
              // we want each separate column to create a series
              if (result.target.alias)
                var alias = self.templateSrv.replace(result.target.alias, options.scopedVars);

              var target = alias || result.data.properties.name || result.data.properties.vs + '/' + result.data.properties.metric;
              series[[result.series_id, cols[i]]] = { target: target + (cols.length > 1 ? "." + cols[i] : ""), datapoints: [] }
            }

          for (var i = 0; i < cols.length; ++i){
            var cnct = AdmDbDatasource.prototype.select_cols(
                result.data.values,
                result.data.properties.columns,
                [cols[i]].concat(["time"])
              );
            if(cnct != null) { // also checks for undefined
              series[[result.series_id, cols[i]]].datapoints = series[[result.series_id, cols[i]]].datapoints.concat(cnct); // TBD: check that file chunks are sorted !
            }
          }
          //console.log(series)
        }
      })

      series = _.map(series, function (v, i) { return v; })
      // cut the points that are anyway not shown in the graph
      for(var si=0;si<series.length;si++){
        var x = _.sortedIndexBy(series[si].datapoints,    [555, from], function(x){return x[1];}); // TBD: check that this search works correctly
        var y = _.sortedIndexBy(series[si].datapoints,    [555, to+1], function(x){return x[1];});
        series[si].datapoints = series[si].datapoints.splice(x,y);
      }

      if(bGeoTable){
        /*
        series[0].datapoints // array of [ip,ts]
        series[1].datapoints // array of [country_code,ts]
        series[2].datapoints // array of [region,ts]
        series[3].datapoints // array of [lat,ts]
        series[4].datapoints // array of [lon,ts]
        geohash.encodeGeoHash(0,0);
        */
        var agregation = {} //  {"1.1.1.1":[5,"gcc"]}; // maps ip:[count,geohash]

        if(series && series.length===5 && series[0].datapoints){
          for(var di=0; di<series[0].datapoints.length; di++){
            if(series[0].datapoints[di][0]){ // if some ip
              var ip = series[0].datapoints[di][0];
              if(ip in agregation){
                agregation[ip][0]++;
              } else {
                var gh = "";

                try{
                  lat = series[3].datapoints[di][0];
                  lon = series[4].datapoints[di][0];
                  gh = geohash.encodeGeoHash(lat,lon);
                } catch(e){
                  try {
                    var country_code = series[1].datapoints[di][0];
                    if(country_code !== "US"){
                      var c = _this.Countries(country_code);
                      if(c){
                        gh = geohash.encodeGeoHash(c.latitude,c.longitude);
                      }
                    } else { // USA
                      var region = series[2].datapoints[di][0];
                      var c = _this.States(region);
                      gh = geohash.encodeGeoHash(c.latitude,c.longitude);
                    }
                  }catch(e){}
                }
                
                agregation[ip]=[1,gh];
              }
            }
          }
        }
        
        //console.log(agregation);
        //console.log(["geo",_this.Countries("US"), _this.States("AL")]);

        var rrr = []
        /*
        for(var i=0;i<10;i++)
          rrr.push(["g"+["c",""][i%2]+(i%10),i,"jhdfhjdfhj"])
        */
        var gh_dict = {} // map gh_dict:[count, ip] // or ip,... if more ip's present on same geohash
        for(var ip in agregation){
          if(agregation[ip][1] in gh_dict){
            gh_dict[agregation[ip][1]][0] += agregation[ip][0]; // count+=
            if(!gh_dict[agregation[ip][1]][1].endsWith(",..."))
              gh_dict[agregation[ip][1]][1] +=',...'
          } else {
            gh_dict[agregation[ip][1]] = [agregation[ip][0], ip]
          }

        }
        //console.log(gh_dict)

        for(var gh in gh_dict){
          rrr.push([gh, gh_dict[gh][0], gh_dict[gh][1]]);
        }
        //console.log(rrr)
        /*
        for(var ip in agregation){
          rrr.push([agregation[ip][1],agregation[ip][0],ip]);
        }
        */
        
        return self.q.when({ data: [ { "columns": [{"text":"geohash"},{"text":"metric"},{"text":"locationName"}], "rows":rrr, "type":"table" } ]}); // {"text":"key"}
      }
      console.log(["end",series])
      
      return self.q.when({ data: series });
      /*return self.q.when({data:
        [{datapoints:[[1,Date.now()],[2,Date.now()+1],[3,Date.now()+2] ], target:"asdfasdfasdf"}]
      });*/
    })

  };

/*
  performs data query, returned data used as annotation
  {"vs":"/Common/data", "metric":"info.status", "columns":["v0"]} 
*/
  AdmDbDatasource.prototype.annotationQuery = function (options) {
    options.targets = [{
      "query": options.annotation.query,
      "alias": options.annotation.titleColumn || options.annotation.name
    }
    ]
    //options.database = options.annotation.datasource;

    // annotation.titleColumn || annotation.name - need to use as alias somehow
    var A = options.annotation;
    //console.log(["annotationQuery.options", options]);
    return this.query(options).then(function (qret) {
      //console.log(["as", qret.data])
      var data = qret.data[Object.keys(qret.data)[0]];
      var ret = []
      if (data) {
        ret = _.map(data.datapoints, function (dp) {
          return { annotation: A, time: dp[1], title: dp[0], text: data.target }//, tags:"tttt", text:"texxxx"}
        })
      }
      //console.log(["a", ret])
      return self.q.when(ret);
    });
  };
/**
 * validates that the name is properly escaped as expected from vs folder
 * @param {string} s 
 */
  AdmDbDatasource.prototype.validateUriComponentEncoding = function(s) {
    return _.isString(s) && s.length%2==0 && 
      s.indexOf("\n") == -1 && s.indexOf("\r") == -1 &&
      _.filter(s.match(/.{2}/g),
        (vv)=>{
          return !((vv[0]=='_' && /[0-9a-zA-Z\-_.]/.test(vv[1])) || /[0-9a-f]{2}/.test(vv))
        }).length==0;
  };
/*
  performs a test connection to the bigip through the rest api.
  from configuration:
    1. needs the url - in the form of https://[ip]
    2. access must be through proxy 
    3. use basic authentication and put the bigip user and password
    4. specify database name - it should be 'default' if you havent crafted something else
  lists the databases in the bigip and if your present returns success
*/
AdmDbDatasource.prototype.testDatasource = function() {
  var _this = this; // cause this is lost inside the following

  var options1 = {
    method: 'POST',
    url:    this.url + '/mgmt/tm/util/admdb',
    params: '',
    data: {"command":"run","utilCmdArgs": 'list-element "'+_this.base_path+'/'+_this.database+'/"'},
    headers : {'content-type': 'application/json'}
  };

  var options2 = {
    method: 'POST',
    url:    this.url + '/mgmt/tm/util/bash',
    params: '',
    data: {"command":"run","utilCmdArgs": '-c "ls -m '+_this.base_path+'/'+_this.database+'/"'},
    headers : {'content-type': 'application/json'}
  };

  /* when working make sure to check both fields to correctly work with api */
  this.admdb_interface = { 
    permissions:''/*guest|admin|guest,admin*/, 
    db_version:''/*v2|v1*/
  };

  return this.allSettled([
    this.backendSrv.datasourceRequest(options1).then(
      function(res){
        if(res.data.commandResult.startsWith("can't run")){throw 1;}
        _this.admdb_interface.permissions += ',guest'
        return res.data.commandResult;
      }, 
      function(res){
        _this.admdb_interface.permissions.replace(',guest','')
        throw 1;
      }
    ),
    this.backendSrv.datasourceRequest(options2).then(
      function(res){
        if(res.data.commandResult.startsWith("can't run")){throw 1;}
        _this.admdb_interface.permissions += ',admin'
        return res.data.commandResult;
      }, 
      function(res){
        _this.admdb_interface.permissions.replace(',admin','')
        throw 1;
      }
    )
  ]).then(function(promises){
    // find the first not rejected
    for(let i=0;i<promises.length;i++) {
      if(promises[i].state == "fullfilled" && "value" in promises[i]){
        let cmd_res = promises[i].value;
        if(cmd_res.startsWith('ls: ')) {
          return _this.q.when({ status: "error", message: "DataBase not found in DataSource", title: "Error" });
        } else {
          let db_contents = cmd_res.slice(0,-1).split(',');
          if(db_contents.indexOf('vs')!=-1){
            _this.admdb_interface.db_version='v2';
          } else if(db_contents.length > 0 && _this.validateUriComponentEncoding(db_contents[0])) {
            _this.admdb_interface.db_version='v1';
          }
          return _this.q.when({ status: "success", message: "DataBase found in DataSource", title: "Success" });
        }     
      }
    }
    return _this.q.when({ status: "error", message: "DataSource not responding", title: "Error" });
  })
};

  /* support metric queries:
     {"list_vs":1}  - list virtual servers in current db 
     {"list_ms":1}  - list measurment names in first found vs (not "all") 
     {"list_ms":1, "vs":"/Common/data"} - list ms in specific vs */
  AdmDbDatasource.prototype.metricFindQuery = function (query) {
    //console.log("m enter");
    var this_url = this.url, this_database = this.database;
    var _this = this;
    if(query.internal!==1) {
      query = new AdmQueryBuilder({query:query}).build()
    }

    if(query.list_vs) {

      var o = {
        method: 'POST',
        url:    this.url,
        params: '',
        data: {"command":"run","utilCmdArgs": ''+_this.base_path+'/'+this_database+'"'}, 
        headers : {'content-type': 'application/json'},
        inspect: {type: this.type}
      };

      if(_this.admdb_interface.permissions.indexOf('guest') >= 0 && _this.admdb_interface.db_version == 'v1'){
        o.url += '/mgmt/tm/util/admdb';
        o.data.utilCmdArgs = 'list-element "' + o.data.utilCmdArgs;
      } else if(_this.admdb_interface.permissions.indexOf('admin') >= 0 && _this.admdb_interface.db_version == 'v1'){
        o.url += '/mgmt/tm/util/bash';
        o.data.utilCmdArgs = '-c "ls -m ' + o.data.utilCmdArgs;
      } else {
        return self.q.when([]);
      }

      

      console.log(["metricFindQuery.list_vs.url", o.url, o.data.utilCmdArgs]);
      return this.backendSrv.datasourceRequest(o).then(
        function (res) {
          if(res.data.commandResult){
            var x = res.data.commandResult;
            var vs_names = x.slice(0,-1).split(',').map(function(s){return s.trim();});
            // result.data - is js array of directories relative to all db names, containing folders in current db (should be all the vs's)
            return self.q.when(
              _.map(vs_names, function(v){
                //var s = v.split('/');
                return {text: AdmDbDatasource.prototype.fixedDecodeURIComponent(v), expandable: true};
              }));
          } else {
            return self.q.when([]);
          }
        });
    }
    var THIS = this;
    if(query.list_ms) {
        if(!("vs" in query)){ // we need to find some vs (not "all"), and then get all measurements from it
            return this.metricFindQuery('{"list_vs":1}').then(function(arr){
                //console.log(arr);
                for(var i=0; i<arr.length;i++){
                    if('text' in arr[i] && arr[i].text !== "all"){
                        return THIS.metricFindQuery(JSON.stringify({"list_ms":1, "vs":arr[i].text}));
                    }
                }
                return self.q.when([]);
            })
        }

        // probably will work directly in grafana 2.6, since they stated they have dependant vars, otherwise makes no sence to use this
        var o = {
          method: 'POST',
          url:    this.url + '/mgmt/tm/util/admdb',
          params: '',
          data: {"command":"run","utilCmdArgs": 'list-element "'+_this.base_path+'/'+this_database+'/'+query.vs+'"'},
          headers : {'content-type': 'application/json'},
          inspect: {type: this.type}
        };
        console.log(["metricFindQuery.list_ms.url", o.url, o.data.utilCmdArgs]);
        return this.backendSrv.datasourceRequest(o).then(
          function (res) {
            if(res.data.commandResult){
              var x = res.data.commandResult;
              var ms_names = x.slice(0,-1).split(',').map(function(s){return s.trim();});
              // result.data - is js array of directories relative to cur db and vs, containing folders that are measurments
              return self.q.when(
                _.map(ms_names, function(v){
                  //var s = v.split('/');
                  return {text: v, expandable: true};
                }));
            } else {
              return self.q.when([]);
            }
          });
    }
    return self.q.when([])
}

  return AdmDbDatasource;
});
