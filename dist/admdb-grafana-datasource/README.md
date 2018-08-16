ADMdb plugin for grafana 3.1.1

+ add caching, and fix file precision selection algorithm to speedup metric retrieval.
+ support no_aggr:1 in queries -> makes the query(currently all for this panel) to use the 1000 interval;
    use this for mertics that dont undergo aggregation : info.status, greylist.add, greylist.ip
+ group ip's by location for world map plugin
+ change to work with /shared/admdb folder on bigip as repo for db's
+ edit data source : save & test
+ fix vs no data for table
+ handle wrong column name in series
+ cutting unused graph values
+ fix single stat using far away values
+ fixing handling of missing values in table queries (some vs have missing data)

+ added table support:
    + perfrom queries on all found virual servers, and results presented as table.
    + one of querys need to have "table" property to activate table mode.
    + {"metric":"info.status", "columns":["v0"], "table":1}
    + {"metric":"$ms", "columns":"*"} 

+ annotations:
    + performs data query, returned data used as annotation
        + {"vs":"/Common/data", "metric":"info.status", "columns":["v0"]} 

+ supports data queries
    + {"vs":"$vs", "metric":"$ms", "columns":"*"} - using predfined template vars, fetch all signals
    + {"vs":"$vs", "metric":"$ms", "columns":"*" "no_aggr":1} - will use the best precision 1000 (fetches a lot of files for long time intervals)
    + {"vs":"/Common/data", "metric":"threshold.hdrcachectrl", "columns":["v0"]} - specific virtual server, metric, and specific 1 signal
    + {"vs":"/Common/data", "metric":"threshold.hdrcachectrl", "columns":["v0","v1"]} - like above, but fetch 2 bins
    + {"vs":"$vs", "metric":"*", "columns":"*"} - specific virtual server, fetch all metrics and all signals for each of the metrics
    + {"vs":"$vs", "metric_regex":"sig", "columns":"*"} - specific virtual server, fetch all metrics that pass regular expression and all signals for each of the metrics
        - columns can be specific, and not all

+ support query for Worldmap Panel plugin
    configure on plugin:  Location Data=table, Table Label Field=locationName
    + {"vs":"$vs", "metric":"greylist.add", "columns":"*", "geotable":1 } 

+ support templates:
    + support metric queries:
        + {"list_vs":1}  - list virtual servers in current db   
        + {"list_ms":1}  - list measurment names in first found vs (not "all") 
        + {"list_ms":1, "vs":"/Common/data"} - list ms in specific vs */