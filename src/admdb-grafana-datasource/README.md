ADMdb plugin for grafana 4.2.0
+ improve parsing of txt files in memory and cpu aspects.
+ added cache for files we fetch from bigip : 20 files, and keep for 10 seconds
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
+ on datasource configuration detects datasource api type.
    can work in (admin, admin+rest, guest+rest), v2 database. 

+ support grafana heatmap plugin in "Axes:Data Format:Time Series Buckets" mode, by using query with "bHeatMap":1 option.

+ added table support:
    + perfrom queries on all found virual servers, and results presented as table.
    + one of querys need to have "table" property to activate table mode.
    + vs_regex - to filter only relevant vs's to you
    + {"topic":"info", "metric":"status" "columns":"*", "table":1}

+ annotations:
    + performs data query, returned data used as annotation
        + {"vs":"$vs", "tpms":"info.attack", "columns":"*"} - precision is guessed from span of time, or can be specified in query

+ supports data queries
    + {"vs":"$vs", "topic":"$tp", "precision":8000, "metric":"health$", "columns":[0], "tpms":"$ms"} -
        select data from vs, 
        tpms - if specified it chooses topic.metric
        topic - topic name
        metric - choose exact metric, is processed by template vars, so you cvan use "$vs" strings
        metric_regex - regex that chooses metrics to select ("tps" - choose tps,tpsa; "^tps$" - choose only tps),
            is not processed for $vars from template
        precision - either automatic depending on zoom, or specify :
            "default" - for non aggregated data
            1000, 8000, 64000 - for zoomed out, aggregated suing max function in bigip
        columns - 
            "*" all colums from metric
            number - only one column
            [1,3,5] - choose several columns from metric

    + {"vs":"$vs","topic":"traffic_sample","metric":"good","columns":"*","precision":"default","row_transform":"http_request_format","off_len_payload_ix":"[5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 26]","method_ix":4,"headers":"[21,22]"}
        transformation query, that transforms rows using http_request_format function to html with marked areas.
        off_len_payload_ix - arguments to this transform of colums that are (index,len, ..., payload)
        output is html, that can be used in table panel, interpret the column as string with html.
        method_ix - specifies the column index where method (GET, POST,..) encoded
        headers - specifies columns where headers important for admd (1st 2 args)
                - specifies columns where headers used by signature (2st 2 args), followed by additional flags column index
	+ {"table_columns":["#samples", "request", "signature_name", "predicates"], "series2table":"noTime", "vs":"$vs","topic":"traffic_sample","metric":"matched_signature","columns":"*", "precision":"default", "row_transform":"http_request_format", "off_len_payload_ix":"[5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 26]", "method_ix":4, "headers":"[21,22,23,24,25]", "sample_count_ix":28, "sig_name_ix":27, "sig_pred_ix":29}

		
		
    + http and ssl samples aggregation:
        + {"table_columns":["#samples", "request"], "series2table":"noTime", "vs":"$vs","topic":"traffic_sample","metric":"http.good","columns":"*",   "precision":"default", "row_transform":"http_request_format"}
        + {"table_columns":["#samples", "request", "predicates"], "series2table":"noTime", "vs":"$vs","topic":"traffic_sample","metric":"http.matched_signature","columns":"*", "precision":"default", "row_transform":"http_request_format"}

        + {"table_columns":["#samples", "request"], "series2table":"noTime", "vs":"$vs","topic":"traffic_sample","metric":"ssl.good","columns":"*", "precision":"default", "row_transform":"ssl_request_format"}
        + {"table_columns":["#samples", "request", "predicates"], "series2table":"noTime", "vs":"$vs","topic":"traffic_sample","metric":"ssl.matched_signature","columns":"*", "precision":"default", "row_transform":"ssl_request_format"}

        output is html, that can be used in Datatable panel, interpret the column as string with html.

        series2table - converts resulting series into table format, so it can be presented in table panel in grafana
            ["noTime", "withTime"] - first mode results in table without the time column, the second keeps the time column
        table_columns - list of names how to name each of the resulting table columns
        row_transform - ssl_request_format|http_request_format activates the parsing of sample metrics and rendering them as html	

+ support query for Worldmap Panel plugin
    configure on plugin:  Location Data=table, Table Label Field=locationName
    + confiugre template: $default_metric	{"list_metric":1, "vs":"$vs", "topic":"$tp", "precision":"default"}
    + {"vs":"$vs", "topic":"$tp", "metric":"$default_metric$", "columns":"*", "geotable":1}

+ support templates:
    + support metric queries:
        + {"list_vs":1}  - list virtual servers in current db   
        + {"list_topic":1, vs:"$vs"} - lists topics under selected vs
        + {"list_metric":1, "vs":"$vs", "topic":"$tp", "precision":1000} - list metrics found in recent files in vs, topic. precision = "default" for non agregated metrics
        + {"list_tpms":1}  - list topic.metrics names in first found vs (not "all") (uses python on bigip)
        + {"list_tpms":1, "vs":"$vs"} - list topic.metrics in specific vs, in 1000 and default precisions (uses python on bigip)