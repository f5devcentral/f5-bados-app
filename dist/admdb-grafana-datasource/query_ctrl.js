/**
 * Created by kruman on 22/12/2015.
 */

define([
  'angular',
  'app/plugins/sdk',
  './query_builder',
],
function (angular, sdk, AdmQueryBuilder) {
  'use strict';

  var seriesList = null;

  var AdmDBQueryCtrl = (function(_super) {
    var self;

    function AdmDBQueryCtrl($scope, $injector, $timeout) {
      _super.call(this, $scope, $injector)
      this.timeout = $timeout;
      this.scope = $scope;

      var target = this.target;
      $scope.queryBuilder = new AdmQueryBuilder(target);
     
      self = this;
    };

    AdmDBQueryCtrl.prototype = Object.create(_super.prototype);
    AdmDBQueryCtrl.prototype.constructor = AdmDBQueryCtrl;

    AdmDBQueryCtrl.templateUrl = 'partials/query.editor.html';

    AdmDBQueryCtrl.prototype.toggleEditorMode = function () {
      this.target.rawQuery = !this.target.rawQuery;
    };

    return AdmDBQueryCtrl;

  })(sdk.QueryCtrl);

  return AdmDBQueryCtrl;
});
