define([
  './datasource',
  './query_ctrl'
],
function(AdmDbDatasource, AdmDBQueryCtrl) {
  'use strict';

  var AdmDBConfigCtrl = function() {}
  AdmDBConfigCtrl.templateUrl = "admdb-grafana-datasource/partials/config.html";

  //var AdmDBQueryOptionsCtrl = function() {}
  //AdmDBQueryOptionsCtrl.templateUrl = "partials/query.options.html";

  var AdmDBAnnotationsCtrl = function() {}
  AdmDBAnnotationsCtrl.templateUrl = "admdb-grafana-datasource/partials/annotations.editor.html";

  return {
    'Datasource': AdmDbDatasource,
    'QueryCtrl': AdmDBQueryCtrl,
    'ConfigCtrl': AdmDBConfigCtrl,
    //'QueryOptionsCtrl': AdmDBQueryOptionsCtrl,
    'AnnotationsQueryCtrl': AdmDBAnnotationsCtrl
  };
});