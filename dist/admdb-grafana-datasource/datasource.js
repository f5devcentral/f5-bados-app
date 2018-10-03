define([
  'angular',
  'lodash',
  'app/core/utils/datemath',
  './query_builder',
  './geohash',
  './data/countries',
  './data/states',
  './train_array',
],
function (angular, _, dateMath, AdmQueryBuilder, geohash, countries, states, ta) {
  'use strict';

  function AdmDbDatasource(instanceSettings, $q, backendSrv, templateSrv) {
    console.log(instanceSettings);
    console.log(arguments);
    this.type = 'grafana-admdb-datasource';
    this.url = instanceSettings.url;
    this.database = instanceSettings.jsonData.database
    this.name = instanceSettings.name;
    this.base_path = '/shared/admdb' // tbd: temporal change

    this.q = $q;
    this.backendSrv = backendSrv; 
    this.templateSrv = templateSrv;
    this.States = states(); // function to query for state names, and get {lat,lon}
    this.Countries = countries(); // function to query for country names, and get {lat,lon}

    this.cache = {}; // map that caches files for x secs
    this.admdb_interface = { 
      permissions:'guest'/*guest|admin|guest,admin*/, 
      db_version:'v2'/*v2|v1*/
    };
  }

  AdmDbDatasource.prototype.ptPerFile = 4096; // points per file
  AdmDbDatasource.prototype.sRatesMs = _.map(_.range(3), function(x){return Math.pow(8,x)*1000}) // predefined, maybe later fetch it ; steps in ms between points in various precisions
  AdmDbDatasource.prototype.getSRate = function(sRate) { // return the min sample rate that is >= than sRate
      var x = this.sRatesMs;
      for(var i=0; i<x.length && sRate>x[i]; i++);
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
      if(!s) {
          return s;
      }
      var ret = "";
      for(var i=0; i<s.length; ++i) {
        if(s[i]!='_') {
          ret+=s[i];
        } else if(s.slice(i,i+2) == "__") {
          ret+="_";
          ++i;
        } else {
          ret+=String.fromCharCode(parseInt(s.slice(i+1,i+3), 16));
          i+=2;
        }
      }
      return ret;
  } 
  AdmDbDatasource.prototype.fixedEncodeURIComponent = function(s) {
    if (!s) return s;

    return s.replace(/./g, function (c) {
      var i = c.charCodeAt(0);
      if (('a' <= c && c <= 'z') ||
        ('A' <= c && c <= 'Z') ||
        ('0' <= c && c <= '9'))
        return c;
      if (c === '_')
        return '__';
      return '_' + i.toString(16);
    });
  };

/* supports data queries
  {"vs":"$vs", "metric":"$ms", "columns":"*"} - using predfined template vars, fetch all signals
  {"vs":"/Common/data", "metric":"threshold.hdrcachectrl", "columns":["v0"]} - specific virtual server, metric, and specific 1 signal
  {"vs":"/Common/data", "metric":"threshold.hdrcachectrl", "columns":["v0","v1"]} - like above, but fetch 2 bins
  {"vs":"$vs", "metric":"greylist.add", "columns":"*", "geotable":1 }  - this is for worldmap panel plugin; locationdata=table, labelfield=locationName
  {"vs":"$vs", "metric":"*", "columns":"*"} - specific virtual server, fetch all metrics and all signals for each of the metrics
  {"vs":"$vs", "metric_regex":"sig", "columns":"*"} - specific virtual server, fetch all metrics that pass regular expression and all signals for each of the metrics
 */
  AdmDbDatasource.prototype.query = function (options, enableTable=true, settings) {
    console.log(["query.options", options, this.backendSrv, this.templateSrv]);  
    //return _this.q.when({ data: [ { "columns": [{"text":"A"},{"text":"B"},{"text":"C"}], "rows":[["<a class ></a>",2,3],[4,5,6]], "type":"table" } ]});
    //var bNoAggregation = false; // true if one of the queries requires no agreagtion, currently this implies that all will be considered as no agregation, and be sampled from the 1000 interval
    var bGeoTable = false; // if tag found in some query - we convert the results to be suitable for worldmap panel table iput with "Table Label Field"=locationName
    var bTable = false; // if tag found in some query treat all queries as column selects for table, whos rows are all vs
    var tableVs = /.*/

    var dont_add_vs_to_target_names = false;
    let bHeatMap = false
    var from = dateMath.parse(options.range.from).valueOf();
    var to = dateMath.parse(options.range.to).valueOf();
    var series2table = false
    var table_columns = undefined
    var _this = this
    var targets = 
      _.filter(options.targets, function (target) { return !target.hide })
      .map(
        function (target, series_id) {
          var query = new AdmQueryBuilder(target, options).build(_this.templateSrv, options.scopedVars);
          if(query.bHeatMap === 1) bHeatMap = true;
          if(query.geotable === 1) bGeoTable = true; 
          if(query.table && enableTable) {bTable = true; _this.tableVs = (typeof query.vs_regex !== 'undefined' && query.vs_regex) || _this.tableVs}
          if(query.series2table) series2table = query.series2table
          if(settings && settings.vs !== undefined) 
            query.vs = _this.fixedEncodeURIComponent(settings.vs)
          if(settings && settings.dont_add_vs_to_target_names != undefined) 
            dont_add_vs_to_target_names = settings.dont_add_vs_to_target_names
          return query;//{vs:query.vs, metric:query.metric, columns:query.columns, base_alias:target.alias}
        }
      )
    //console.log(['targets',targets])
    
    
    if(bTable){ 
        // support for vs filtering - done on rows of this table  
        var vs_test = function(x) {return true} // no filtering by default
        if(_.isString(_this.tableVs)){
          vs_test = function(s) {return _this.tableVs === s}
        } else if (_.isRegExp(_this.tableVs)){ // for regex
          vs_test = function(s) { return _this.tableVs.test(s) }
        } 
        return this.list_remote_dir(_this.base_path+'/'+_this.database+"/vs")
          .then(function(vs_arr){
            var vs_escaped_arr = vs_arr.map(_this.fixedDecodeURIComponent).filter(vs_escaped=>vs_test(vs_escaped))
            return _this.allSettled(vs_escaped_arr.map(function(vs){
              return _this.query(options,false, {vs:vs, dont_add_vs_to_target_names:true})
            }))
            .then(function(p_array){
              var column_names2ix = {vs:0}
              var data = { "columns": [{ "text": "vs" }], "rows": vs_escaped_arr.map(function(vs){return [vs]}), "type": "table" }
              p_array.forEach(function(pquery,irow){
                if(pquery.state === "fullfilled") {
                  pquery.value.data.forEach(function(cell){
                    cell.datapoints;
                    if(column_names2ix[cell.target] === undefined) {
                      column_names2ix[cell.target] = Object.keys(column_names2ix).length
                      data.columns.push({ "text": cell.target })
                    }
                    data.rows[irow][column_names2ix[cell.target]] = cell.datapoints.pop()[0]
                  })
                }
              })
              //console.log([p_array,vs_escaped_arr])
              //return _this.q.when([])
              return _this.q.when({ data: [data] });
            })
          })
      
    }

    return this.allSettled(
      targets.map(function(target){

        if(target.table_columns)
          table_columns = target.table_columns // maybe concat ?
        
        var args = [_this.base_path + '/' + _this.database + '/vs', target.vs, target.topic, target.precision, [from, to], false]
        try{target.off_len_payload_ix=JSON.parse(target.off_len_payload_ix)}
        catch(e){target.off_len_payload_ix=[]}
        try{target.headers=JSON.parse(target.headers)}
        catch(e){target.headers=[]}

        let ret = _this.cat_remote_train_index(...args)
          .then(_this.cat_remote_train.bind(_this, ...args));
        
        if(target.row_transform==="ssl_request_format" || target.row_transform==="http_request_format"){
          ret = ret.then(function(tarr) {return (new ta(tarr)).parse()})
            .then((function(m,ts_rng,ta){return ta.filter(m,ts_rng)}).bind(_this, target.metric_regex || target.metric, [from, to]))
            .then(ta=>ta.aggregate())
            .then(ta=>_this.q.when(ta.render()))
        }
        
        return ret.then(_this.select.bind(_this, target.metric_regex || target.metric, [from, to], target.columns, target.alias, target.topic))
          .then(
          function (data) {
            if (target.alias === "" && dont_add_vs_to_target_names !== true) { // add vs to target names
              data.forEach(function (t, i, arr) {

                arr[i].target = AdmDbDatasource.prototype.fixedDecodeURIComponent(target.vs) + '.' + t.target
              })
            }            
            return data
          },
          function (err) { return [] }
          )
        
        
      })
    ).then(function(promises){
      var data =  _.flatten(promises.map(function(promise){
        if(promise.state==='fullfilled')
          return promise.value
        return [{target:'err', datapoints:[]}]
      }))
      return _this.q.when({data:data})

    })
    .then(function(data){
      if(bGeoTable){
        return _this.series_2_worldmap_table(data.data)
      } else
        return data
    }).then(function(data){
      if(series2table){
        return _this.series_2_table(data.data, table_columns, series2table) // transform traffic samples to table
      }else{
        return data
      }
    }).then(function(data){
      if(bHeatMap){
        Object.values(data.data).forEach((v,i)=>v.target=i)
        return data; 
      } else {return data}
    })
  };

  /** converts a series list to a table, with first column time, and the other columns taken from each series values
  time is not checked to match in different series, the series are just merged based on index
  @param series - {0:{datapoints:[[v,ts],[v,ts],...]}, 1:{...}, .. }
  @param col_names - list of column names to give to the data (the output time column is called "Time", no need to supply)
  @param op_mode - ["noTime", "withTime"] - first mode reults in table without the time column, the second keeps the time column

 */
  AdmDbDatasource.prototype.series_2_table = function(series, col_names, op_mode) {
    var table_hdr = []
    if(op_mode == "withTime"){
      table_hdr = [{"text":"Time","type":"string"}]
    }
    try{
    var timestamps = _.unzip(series[0].datapoints)[1]
    var rows = _.unzip([timestamps].concat(_.map(series,(v,k)=>{return _.unzip(v.datapoints)[0]}))) // v.target
    if(op_mode == "noTime") {
      rows = rows.map(r=>r.slice(1))
    }
    var d= { data: [{ "columns": table_hdr.concat(_.map(series, (v,k)=>{return {"text":col_names[k], "type":"string"}})), "rows": rows, "type": "table" }] }
    //console.log(rows)
    return this.q.when(d);
    } catch(e){
      return this.q.when({data:[]});
    }
  }

  AdmDbDatasource.prototype.series_2_worldmap_table = function (series) {
    var _this = this
    /*
    series[0].datapoints // array of [ip,ts]
    series[1].datapoints // array of [country_code,ts]
    series[2].datapoints // array of [region,ts]
    series[3].datapoints // array of [lat,ts]
    series[4].datapoints // array of [lon,ts]
    geohash.encodeGeoHash(0,0);
    */
    console.log(series)
    var agregation = {} //  {"1.1.1.1":[5,"gcc"]}; // maps ip:[count,geohash]

    if (series && series.length >= 3 && series[0].datapoints) {
      for (var di = 0; di < series[0].datapoints.length; di++) {
        if (series[0].datapoints[di][0]) { // if some ip
          var ip = series[0].datapoints[di][0];
          if (ip in agregation) {
            agregation[ip][0]++;
          } else {
            var gh = "";

            try {
              var lat = series[3].datapoints[di][0];
              var lon = series[4].datapoints[di][0];
              gh = geohash.encodeGeoHash(lat, lon);
            } catch (e) {
              try {
                var country_code = series[1].datapoints[di][0];
                if (country_code !== "US") {
                  var c = _this.Countries(country_code);
                  if (c) {
                    gh = geohash.encodeGeoHash(c.latitude, c.longitude);
                  }
                } else { // USA
                  var region = series[2].datapoints[di][0];
                  var c = _this.States(region);
                  gh = geohash.encodeGeoHash(c.latitude, c.longitude);
                }
              } catch (e) { }
            }

            agregation[ip] = [1, gh];
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
    for (var ip in agregation) {
      if (agregation[ip][1] in gh_dict) {
        gh_dict[agregation[ip][1]][0] += agregation[ip][0]; // count+=
        if (!gh_dict[agregation[ip][1]][1].endsWith(",..."))
          gh_dict[agregation[ip][1]][1] += ',...'
      } else {
        gh_dict[agregation[ip][1]] = [agregation[ip][0], ip]
      }

    }
    //console.log(gh_dict)

    for (var gh in gh_dict) {
      rrr.push([gh, gh_dict[gh][0], gh_dict[gh][1]]);
    }
    //console.log(rrr)
    /*
    for(var ip in agregation){
      rrr.push([agregation[ip][1],agregation[ip][0],ip]);
    }
    */
    console.log(rrr)
    return _this.q.when({ data: [{ "columns": [{ "text": "geohash" }, { "text": "metric" }, { "text": "locationName" }], "rows": rrr, "type": "table" }] }); // {"text":"key"}

  }

/*
  performs data query, returned data used as annotation
  {"vs":"/Common/data", "metric":"info.status", "columns":["v0"]} 
*/
  AdmDbDatasource.prototype.annotationQuery = function (options) {
    var _this = this
    options.targets = [{
      "query": options.annotation.query,
      "alias": options.annotation.titleColumn || options.annotation.name
    }
    ]
    //options.database = options.annotation.datasource;

    // annotation.titleColumn || annotation.name - need to use as alias somehow
    var A = options.annotation;
    console.log(["annotationQuery.options", options]);
    return this.query(options).then(function (qret) {
      console.log(["as", qret.data])
      var data = qret.data[Object.keys(qret.data)[0]];
      var ret = []
      if (data) {
        ret = _.map(data.datapoints, function (dp) {
          return { annotation: A, time: dp[1], title: dp[0], text: data.target }//, tags:"tttt", text:"texxxx"}
        })
      }
      //console.log(["a", ret])
      return _this.q.when(ret);
    });
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
            } else if(db_contents.length > 0 && db_contents[0].length%2==0) {
              _this.admdb_interface.db_version='v1'; /** TBD: improve this validation once i merge the v1 code here */
            }
            return _this.q.when({ status: "success", message: "DataBase found in DataSource", title: "Success" });
          }     
        }
      }
      return _this.q.when({ status: "error", message: "DataSource not responding", title: "Error" });
    })
  };

  AdmDbDatasource.prototype.list_metrics = function(vs_folder, vs) {
    let _this = this;
    if(this.admdb_interface.permissions.indexOf('guest') >= 0 && this.admdb_interface.db_version == 'v2'){
      var o = {
        method: 'POST',
        url: _this.url + '/mgmt/tm/util/admdb',
        params: '',
        data: { "command": "run", "utilCmdArgs": 'list-metrics "' + vs_folder + '" "' + vs + '"'},
        headers: { 'content-type': 'application/json' },
        inspect: { type: 'admdb' },
        precision: "ms"
      };
      return _this.backendSrv.datasourceRequest(o).then(
        function(result){
          //console.log(result);
          if (result.data.commandResult) {
            var data = result.data.commandResult;
            console.log(['data',data])
            return _this.q.when(JSON.parse(data))
          }
        }
      )
    } else if(this.admdb_interface.permissions.indexOf('admin') >= 0 && this.admdb_interface.db_version == 'v2'){
      return this.run_python_code(
        _this.list_metrics_py, 
        'list_metrics', vs_folder, vs)
    } else {
      return _this.q.when([])
    }
  }

  /* will work only for admin bigip user 
  returns a promise to run a remote python code
  first code encoded and injected to bigip, along with the entry func_name to start from
  and supply the arguments 
  make sure to return json.dumps() from python */ 
  AdmDbDatasource.prototype.run_python_code = function(pcode, func_name, ...args) {
    if(this.admdb_interface.permissions.indexOf('admin') == -1){
      throw new Error("need admin permission")  // safety
    }
    var _this = this
    console.log([pcode, func_name, args])
    var str_b64 = (`undefined = None
`+pcode + 
`
print `+func_name+`(`+args.map(function(arg){return JSON.stringify(arg)}).join()+`)`);

    console.log(str_b64)
    var o = {
      method: 'POST',
      url: _this.url + '/mgmt/tm/util/bash',
      params: '',
      data: { "command": "run", "utilCmdArgs": '-c "echo ' + btoa(str_b64) + `|python -c 'import base64; exec(base64.b64decode(raw_input()))' "` },
      headers: { 'content-type': 'application/json' },
      inspect: { type: 'admdb' },
      precision: "ms"
    };
    //console.log(o);
    return _this.backendSrv.datasourceRequest(o).then(
      function(result){
        //console.log(result);
        if (result.data.commandResult) {
          var data = result.data.commandResult;
          console.log(['data',data])
          return _this.q.when(JSON.parse(data))
        }
      }
    )
  }

  /** returns ts points containing [from,to) range, and land on each ms_per_file (qauntization from 0)
   * point before from is also returned
   * 01234.01234.01234.01234.01234.01234.0123       
   * 0-----[from-----------------------------to)----->
   * @param quant_diff - range is sampled each diff, starting from 0
   * @param from - start of range, first point returned <= from
   * @param to - last point, no included in range, last point returned < to
   *  if @to omitted then from is considered to be a pair of [from,to]
  */
  AdmDbDatasource.prototype.ts_range_quantization = function(quant_diff, from, to) {
    if(to === undefined || to === null){
      to = from[1]
      from = from[0]
      //to = from
    }
    return _.range(+from - (+from % (+quant_diff)), +to, +quant_diff)
  }

  /** @return promise that gets fullfilled when all promises each either succ or fail */
  AdmDbDatasource.prototype.allSettled = function(promises) {
    // $q missing this in grafana
    return this.q.all(
      promises.map(function(promise){ 
        return promise.then(
          function(x){return {state:'fullfilled', value:x}}, 
          function(e){return {state:'rejected', reason:e}}
        )
      })
    )
  }
  /** generator implementation of string.split 
   * @param s - string to split
   * @param sep - separator which is used to separates chuncks
   * @param cb - called for each found chunk, giving :
   *  cur - the chunk
   *  idx - the number of the chunk
   *  s - the whole original string
  */
  AdmDbDatasource.prototype.split = function(s, sep, cb/*cur,idx,s*/) {
    var soff1;
    var soff = 0;
    var idx =0;
    for(;soff !== undefined;++idx){
     var soff1 = s.indexOf(sep,soff+1);
     if(soff1 === -1) soff1 = undefined;
     cb(s.slice(soff,soff1), idx, s);
     soff = soff1;
    }
   }

  /** @return promise to return array of {target:"x", datapoints:[]}
  * @param metric - regex, or string
  * @param utc_ts_ms_range - [from ,to], filter points in this range, if to==-1, then unbounded to end
  * @param columns - 0 or [1,4,7] or "*"
  * @param base_alias - specify alias to rename targets
  * @param train_array - reiceves array of jsons, each : [string metric , [values]]
  */
  AdmDbDatasource.prototype.select = function(metric, utc_ts_ms_range, columns, base_alias, topic, train_array){
    //var data = []
    //console.log(['select',arguments])
    var metric_test = function(x) {return false}
    if(_.isString(metric)){
      metric_test = function(s) {return metric === s}
    } else if (_.isRegExp(metric)){ // for regex
      metric_test = function(s) { return metric.test(s) }
    }

    var cur_ts;
    var from = utc_ts_ms_range[0], to = utc_ts_ms_range[1]
    var metric_column_2_series_map = {
      data: {},
      insert: function(metric, row, cols, ts){
        cols.forEach(function(col){
          //console.log(arguments)
          if(row[col]!==undefined){
            if(this.data[[col,metric]] === undefined)
              this.data[[col,metric]] = []
            this.data[[col,metric]].push([row[col],ts])
          }
        }.bind(this))
      },
      get : function(base_alias, topic) {
        return _.map(this.data, function(v,k,d){
          // k - col,metric
          //console.log([base_alias,k[1],k[0]])
          var i = k.indexOf(',')
          var col = k.slice(0,i)
          var metric = k.slice(i+1)
          //console.log(['111', base_alias, topic, col, metric ])
          if (Object.keys(d).length==1 && base_alias!=undefined && base_alias!="") 
            return {target:base_alias, datapoints:v}
          else
            return {target:[((base_alias!=undefined && base_alias!="")?base_alias:topic), metric, col].join('.'), datapoints:v}
        })
      }
      
    };
    train_array.forEach( function(v,i,arr) {
      try{
        if(v[0]==="_ts_ms") {
          //console.log(v)
          cur_ts = +v[1]
        } else if(cur_ts!==undefined && from <= cur_ts && (cur_ts < to || to == -1)) { // time fine
          
          if(metric_test(v[0])){ // put each metric in its target
            //console.log(v)
            var columns_selected; 
            
            if(_.isString(columns)) {
              if(columns === "*") {
                columns = _.range(v[1].length)
              } else {
                columns = JSON.parse(columns)
              }
            }          
            if(_.isArray(columns)) {
              columns_selected = _.intersection(columns, _.range(v[1].length))
            } else if(_.isInteger(columns)) {
              columns_selected = [columns]
            } else {
              columns_selected = []
            }
 
            // metric, columns data array, columns picked arr ,ts
            metric_column_2_series_map.insert(v[0], v[1], columns_selected, cur_ts)
          }
          
        }
      } catch(e){console.log(e)}
    })
    //console.log(metric_column_2_series_map.data)
    return this.q.when(metric_column_2_series_map.get(base_alias,topic))
      
    //below sample
    return this.q.when([{target:"a", datapoints:
    [
      [1,utc_ts_ms_range[0]],
      [2,utc_ts_ms_range[1]]
    ]},{target:"b", datapoints:[
      [3,utc_ts_ms_range[0]],
      [4,utc_ts_ms_range[1]]
    ]} ])
  }

  /** @return a promise to cat a train metric part, returns array of rows (can contain extra data more than the ts range)
   * @param vs_abs_path - folder where all vs are present
   * @param vs - vs name (unescaped)
   * @param topic - topic name (unescaped)
   * @param precision - "default"|1000|8000|64000 where to look for data
   * @param utc_ts_ms_range - from,to in utc ms, data to select
   * @param escape - if to escape the vs, topic, precision
   * @param train_index_text - raw output from cat_remote_train_index(), or cached
   */
  AdmDbDatasource.prototype.cat_remote_train = function(vs_abs_path, vs, topic, precision, utc_ts_ms_range, escape, train_index_text){
    var _this = this
    //return this.cat_remote_train_index(vs_abs_path, vs, topic, precision, utc_ts_ms_range, escape).then(function(text){
      //console.log(['1111',train_index_text])
      var from = utc_ts_ms_range[0], to = utc_ts_ms_range[1]
      var train_files = train_index_text.split('\n') // split lines
          .filter(function(line){return line.length>0})
          .map(function(line){return +line.split(',')[0]}) // split each lines to filename, ts, offset, return filename as number
      var ix1 = _.findLastIndex(train_files, function(x){return x<=from})
      if(ix1 === -1) ix1 = 0;
      var ix2 = _.findLastIndex(train_files, function(x){return x<to})
      if(ix2 === -1) return ""; 
      train_files = _.sortedUniqBy(train_files.slice(ix1, ix2+1))// files we need to fetch
      //console.log(["asd",train_files.map(x=>{return new Date(x)}),ix1,ix2, new Date(from) ,new Date(to)])

      var abs_path = ([vs_abs_path].concat([vs, topic, ""+precision].map(function(x){return (escape?_this.fixedEncodeURIComponent(x):x) })))
                      .join('/')

      /* inner func, translates from text file to json array */
      function text2json(train_text){
        var ret = []
        var v;
        AdmDbDatasource.prototype.split(train_text, '\n', function(v,i,arr){
          try{
            v = JSON.parse(v.slice(0,-1)) // also deal with json escaped data
          }catch(e){v = []}
          ret.push(v)
        })
        return ret;
      }
      return _this.allSettled(
        train_files.map(function(fname){            
          return _this.cat_remote_file(abs_path+ '/'+ fname+'.txt', text2json)
        })
      )
      .then(function(promises){
        var ret = promises.filter(function(promise){return promise.state==='fullfilled'})
                .reduce(function(prev,cur){return prev.concat(cur.value)},[]) // return concated train contents as array
        return ret;
      })
    //});
  }

  /** @return a promise to cat a train index part, returns text
   * @param vs_abs_path - folder where all vs are present
   * @param vs - vs name (unescaped)
   * @param topic - topic name (unescaped)
   * @param precision - "default"|1000|8000|64000 where to look for data
   * @param utc_ts_ms_range - from,to in utc ms, data to select
   * @param escape - if to escape the vs, topic, precision
   */
  AdmDbDatasource.prototype.cat_remote_train_index = function(vs_abs_path, vs, topic, precision, utc_ts_ms_range, escape = true){
    // read index file(s)
    var _this = this
    var ix_points = this.ts_range_quantization((precision=="default"?8000:(+precision)) * 60 * 60 * 24, ...utc_ts_ms_range)
    var abs_path = ([vs_abs_path].concat([vs, topic, ""+precision].map(function(x){return (escape?_this.fixedEncodeURIComponent(x):x)})))
                      .join('/')
    
    return this.allSettled(
      ix_points.map(function(ix){            
        return _this.cat_remote_file(abs_path+ '/'+ ix+'.csv')
      })
    )
    .then(function(promises){
      var ret = promises.filter(function(promise){return promise.state==='fullfilled'})
              .reduce(function(prev,cur){return prev+cur.value},"") // return concated indexes
      return ret;
    })
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

  /* returns promise that cats remote file (from, to) file byte offsets zero based 
    @param abs_path - remote file name
    @param cb(res) - post processes result, can throw error, if want to handle do "cat_remote_file_raw().then"
    @param from - byte offset 0 based in file to read from @default 0
    @param from - byte offset 0 based in file to read until (not including), @default -1 till eof
  */
  AdmDbDatasource.prototype.cat_remote_file_raw = function(abs_path, cb=(x=>x), from = 0, to = -1) {
    // tail -c +2 1500982272000.txt | head -c 5
    if(from === undefined || from === null) from = 0;
    if(to === undefined || to === null) to = -1;

    var cmd = "";
    if(from == 0 && to == -1){
      ;
    } else if(from >= 0 && (from<to || to==-1)) {
      ;
    } else {
      return this.q.when([])
    }
    var o = {
        method: 'POST',
        url:    this.url,
        params: '',
        data: {"command":"run","utilCmdArgs": null},
        headers : {'content-type': 'application/json'},
        inspect: {type: this.type} // need this ?
    };
    if(this.admdb_interface.permissions.indexOf('guest') >= 0){
      o.url += '/mgmt/tm/util/admdb';
      o.data.utilCmdArgs = 'view-element "' + abs_path + '"';
    } else if(this.admdb_interface.permissions.indexOf('admin') >= 0) {
      o.url += '/mgmt/tm/util/bash';
      o.data.utilCmdArgs = '-c "cat '+abs_path+'"';
    } else {
      throw new Error("no permissions")
    }

    console.log(["cat_remote_file", abs_path, cmd]);
    return this.backendSrv.datasourceRequest(o)
    .then(function(res) {
      return res.data.commandResult;
    })
    .then(function(cmd_res) {
      if(cmd_res.startsWith('cat: ') || cmd_res.startsWith('tail: ') || cmd_res.startsWith('head: ')) // check this
        throw new Error("failed to read file "+abs_path)
      return cb(cmd_res);
    })
  }
  
  AdmDbDatasource.prototype.cat_remote_file = 
    AdmDbDatasource.prototype.memoize(AdmDbDatasource.prototype.cat_remote_file_raw,function f(){return Array.from(arguments).join(',')}, 10000, 20)

  /* returns promise that lists remote directory
    @param abs_path - is the path to list, make sure to escape it if needed */
  AdmDbDatasource.prototype.list_remote_dir = function(abs_path) {
    var o = {
        method: 'POST',
        url:    this.url,
        params: '',
        data: {"command":"run","utilCmdArgs": null},
        headers : {'content-type': 'application/json'},
        inspect: {type: this.type} // need this ?
      };
      if(this.admdb_interface.permissions.indexOf('guest') >= 0){
        o.url += '/mgmt/tm/util/admdb';
        o.data.utilCmdArgs = 'list-element "'+abs_path+'"';
      } else if(this.admdb_interface.permissions.indexOf('admin') >= 0){
        o.url += '/mgmt/tm/util/bash';
        o.data.utilCmdArgs = '-c "ls -m '+abs_path+'"';
      } else {
        throw new Error("no permissions") 
      }

      console.log(["list_remote_dir", abs_path]);
      return this.backendSrv.datasourceRequest(o)
      .then(function(res) {
        return res.data.commandResult;
      })
      .then(function(cmd_res) {
        if(cmd_res.startsWith('ls: '))
          throw new Error("failed to list directory "+abs_path)
        return cmd_res.split(',')
          .map(function(s){
            return s.trim() 
          });
      })
  };
/*
  @param path - into the vs folder where all vs's are present
  @param vs - name of the vs to search for metrics ('all' ignored), 
    if not specified then first found vs is chosen
  @return - json list of strings, each string is topic.metric,
    for all topics ands metrics found within the 1000 and default precision in the 
    2 most recent train files.
 */
  AdmDbDatasource.prototype.list_metrics_py = `
import json, os, glob, re
# note the double \\, they are eaten by js to a single one, that python needs to escape
pattern = re.compile('\\["([^,\\"]*)\\",')
def list_metrics(path, vs=None):
    if vs is None or vs == 'all':
      # get the first vs!='all'
      try:
          vs = (x for x in (x.split('/')[-1] for x in glob.iglob(path+'/*')) if x !='all').next()
      except: # no vs found
          return json.dumps([]) 

    topics = glob.glob(path+'/'+vs+'/*')
    fnames = []
    for topic_fullp in topics:
        p1000 = glob.glob(topic_fullp+'/1000/*.txt')
        pdefault = glob.glob(topic_fullp+'/default/*.txt')
        p1000.sort()
        pdefault.sort()
        fnames+=p1000[-2:]
        fnames+=pdefault[-2:]
    # open fnames, read all unique metrics
    metrics = set() 
    for file in fnames:
        topic = file.split('/')[-3]
        for line in open(file,'r'):
            try:
                metric = pattern.match(line).group(1)
                metrics.add(topic+'.'+metric)
            except: pass

    # tbd: escape topic as a file, and metric as json encoded
    return json.dumps(list(metrics))

`
  /* support metric queries:
     {"list_vs":1}  - list virtual servers in current db
     {"list_topic":1, vs:"$vs"} - lists topics under selected vs
     {"list_tpms":1}  - list measurment names in first found vs (not "all") 
     {"list_metric":1, "topic":"$tp", "vs":"$vs", "precision":1000} - list metrics recently seen under vs,topic and precision
     {"list_tpms":1, "vs":"/Common/data"} - list ms in specific vs */
  AdmDbDatasource.prototype.metricFindQuery = function (query) {
    //console.log("m enter");
    var this_url = this.url, this_database = this.database;
    var _this = this;
    if(query.internal!==1) {
      query = new AdmQueryBuilder({query:query}).build(_this.templateSrv)
    }
    
    if(query.list_vs) {
      return this.list_remote_dir(_this.base_path+'/'+this_database+"/vs")
        .then(function(vs_arr){
          return vs_arr.map(function(s) {
            return {text: AdmDbDatasource.prototype.fixedDecodeURIComponent(s.trim()), expandable: true};
          });
        })
        .then(function(x){return x;}, function(){return []}); // hide errors
    }

    if(query.list_topic) {
        if(!("vs" in query)){
          //tbd: notify of error
          return _this.q.when([])
        }
        return this.list_remote_dir(_this.base_path+'/'+this_database+'/vs/'+query.vs)
        .then(function(vs_arr){
          return vs_arr.map(function(s) {
            return {text: AdmDbDatasource.prototype.fixedDecodeURIComponent(s.trim()), expandable: true};
          });
        })
        .then(function(x){return x;}, function(){return []}); // hide errors
    }

    if(query.list_metric) {
      if(!("vs" in query) || !("topic" in query)){
        //tbd: notify of error
        return _this.q.when([])
      }
      
      if(query.precision === undefined) 
        query.precision = "default"
      
      return this.list_remote_dir(_this.base_path+'/'+this_database+'/'+["vs",query.vs,query.topic,query.precision].join('/'), false)
      .then(function(file_arr){
        console.log(file_arr)
        // take the last 2 metric files
        var train_index_text = _.sortBy(
          _.filter(file_arr, function(name){return name.endsWith('.txt')})
          .map(function(name){return +(name.slice(0,-4))})
        ).slice(-2).join('\n')+'\n'
        console.log(train_index_text)
        return _this.cat_remote_train(_this.base_path+'/'+_this.database+'/vs', query.vs, query.topic, query.precision, [-1,Number.MAX_SAFE_INTEGER], false, train_index_text)
          .then(function(train_arr){

            var x = _.uniqBy(
              train_arr.filter(
                function(x){return x.length>0})
                .map(function(x){return {text: x[0], expandable: true}}))
                
            return _this.q.when(x)
            })
      })
      .then(function(x){return x;}, function(){return []}); // hide errors
    }

    if(query.list_tpms) {
      return _this.list_metrics(_this.base_path+'/'+this_database+'/vs', query.vs)
      .then(function(arr){
        return arr.map(function(x){return {text:x, expandable: true}});
      })
      .then(function(x){return x;}, function(){return []}); // hide errors
    }
    return _this.q.when([])
  }

  return AdmDbDatasource;
});
