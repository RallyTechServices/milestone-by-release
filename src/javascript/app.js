Ext.define("cats-milestone-by-release", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },

    integrationHeaders : {
        name : "cats-milestone-by-release"
    },

    config: {
      defaultSettings: {
          groupByPortfolioLevel: 1
      }
    },

    portfolioItemTypes: [],
    portfolioItemRecordsByType: {},

    launch: function() {
        this.removeAll();
        if (!this.getContext().getTimeboxScope() || this.getContext().getTimeboxScope().getType() !== 'release'){
           this._addAppMessage("This app is designed to run on a release scoped dashboard.");
           return;
        }

        this._fetchPortfolioItemTypes().then({
          success: this._initializeApp,
          failure: this._showAppError,
          scope: this
        });
    },
    getFeatureName: function(){
        this.logger.log('getFeatureName', this.portfolioItemTypes[0]);
        return this.portfolioItemTypes[0].replace('PortfolioItem/','');
    },
    _initializeApp: function(portfolioItemTypeRecords){
      this.logger.log('_initializeApp', portfolioItemTypeRecords);
      this.portfolioItemTypes = Ext.Array.map(portfolioItemTypeRecords, function(p){ return p.get('TypePath'); });

      this.onTimeboxScopeChange(this.getContext().getTimeboxScope());
    },

    _showAppError: function(msg){
      this.add({
        xtype: 'container',
        itemId: 'errorMessage',
        html: Ext.String.format('<div class="no-data-container"><div class="primary-message">{0}</div></div>',msg)
      });
    },

    _addAppMessage: function(msg){
      this.add({
        xtype: 'container',
        itemId: 'appMessage',
        html: Ext.String.format('<div class="no-data-container"><div class="primary-message">{0}</div></div>',msg)
      });
    },

    _clearWindow: function(){
      if (this.down('#appMessage')){
        this.down('#appMessage').destroy();
      }
      if (this.down('rallygrid')){
        this.down('rallygrid').destroy();
      }
    },

    onTimeboxScopeChange: function(timeboxScope){
        this.getContext().setTimeboxScope(timeboxScope);
        this.logger.log('onTimeboxScopeChange', timeboxScope, timeboxScope.getRecord());

        this._clearWindow();

      if (timeboxScope && timeboxScope.getType() === 'release'){
        if (timeboxScope.getRecord()){
          this._updateDisplay(timeboxScope);
        } else {
          this._addAppMessage("Please select a release to see portfolio milestones for that timebox.");
        }
      } else {
        this._addAppMessage("This app is designed to run on a dashboard with a Release timebox selector.");
      }
    },
    getPortfolioGroupLevel: function(){
      return this.getSetting('groupByPortfolioLevel');
    },
    _buildStore: function(portfolioItems){
      this.logger.log('_buildStore', portfolioItems);

      var data = [];
      var type = this.portfolioItemTypes[this.getPortfolioGroupLevel()].toLowerCase();

      Ext.Object.each(portfolioItems[type], function(objectID, recData){
        var row = recData;
        row.Milestones = this._getMilestones(recData, portfolioItems);
        row.Features = this._getFeatures(recData, portfolioItems);
        if (row.Milestones.length > 0){
          data.push(row);
        }

      }, this);

      this.logger.log('_buildStore', data);
      var store = Ext.create('Rally.data.custom.Store',{
         data: data,
         fields: ['FormattedID','Name','Milestones','Features',"_ref","_type"],
         pageSize: data.length
      });

      this._addGrid(store);
    },

    _addGrid: function(store){
        if (this.down('rallygrid')){
          this.down('rallygrid').destroy();
        }
        this.add({
          xtype: 'rallygrid',
          store: store,
          columnCfgs: this._getColumnCfgs(),
          showRowActionsColumn: false,
          showPagingToolbar: false
        });
    },

    _getColumnCfgs: function(){

      return [{
        dataIndex: 'FormattedID',
        text: "ID",
        renderer: function(m,v,r){
          return Ext.create('Rally.ui.renderer.template.FormattedIDTemplate').apply(r.data);
        }
      },{
        dataIndex: 'Name',
        text: "Name",
        flex: 1
      },{
        dataIndex: 'Milestones',
        text: 'Milestones',
        flex: 1,
        renderer: function(v,m,r){
          return Ext.create('cats-milestone-by-release.utils.MilestonesTemplate', { collectionName: 'Milestones', iconCls: 'icon-milestone', cls: 'milestone-pill'}).apply(r.getData());
        }
      },{
        dataIndex: 'Features',
        text: this.getFeatureName() + 's',
        flex: 1,
        renderer: function(v,m,r){
          return Ext.create('cats-milestone-by-release.utils.PortfolioListTemplate', { collectionName: 'Features', iconCls: 'icon-portfolio'}).apply(r.getData());
        }
      }];

    },
    _getFeatures: function(item, portfolioItemHash){
      var type = item._type && item._type.toLowerCase(),
          portfolioItem = portfolioItemHash[type][item.ObjectID],
          releaseStartDate = this.getContext().getTimeboxScope().getRecord().get('ReleaseStartDate'),
          releaseEndDate = this.getContext().getTimeboxScope().getRecord().get('ReleaseDate');

          var portfolioItemTypeIndex = this._getPortfolioItemTypeOrdinal(type);

          var parents = [portfolioItem.ObjectID];

          this.logger.log('_getFeatures', item.FormattedID, portfolioItemTypeIndex);

          if (portfolioItemTypeIndex > 0){
            portfolioItemTypeIndex--;
              for (var i=portfolioItemTypeIndex; i>=0; i--){
                portfolioType = this.portfolioItemTypes[i].toLowerCase();

                var kids = [];
                Ext.Object.each(portfolioItemHash[portfolioType], function(oid, pi){
                  console.log('parent', parents, pi, pi.Parent)
                   if (Ext.Array.contains(parents, (pi.Parent && pi.Parent.ObjectID))){
                     kids.push(pi);
                   }
                });
                parents = _.pluck(kids, "ObjectID");
              }
          }
          this.logger.log('_getFeatures', parents, kids);
          return kids;
    },
    _getMilestones: function(item, portfolioItems){
      var type = item._type && item._type.toLowerCase(),
          portfolioItem = portfolioItems[type][item.ObjectID],
          releaseStartDate = this.getContext().getTimeboxScope().getRecord().get('ReleaseStartDate'),
          releaseEndDate = this.getContext().getTimeboxScope().getRecord().get('ReleaseDate');


       return this._pluckMilestones(portfolioItem, releaseStartDate, releaseEndDate);
    },
    _pluckMilestones: function(item, startDate, endDate){
      var milestones = [];
      if (item && item.Milestones && item.Milestones._tagsNameArray && item.Milestones._tagsNameArray.length > 0){
        Ext.Array.each(item.Milestones._tagsNameArray, function(m){
          var targetDate = m.TargetDate && Rally.util.DateTime.fromIsoString(m.TargetDate);
          if (targetDate >= startDate && targetDate <= endDate){
              milestones.push(m);
          }
        });
      }
      return milestones;

    },
    // _getMilestones: function(item, portfolioItemHash){
    //   var type = item._type && item._type.toLowerCase(),
    //       portfolioItem = portfolioItemHash[type][item.ObjectID],
    //       releaseStartDate = this.getContext().getTimeboxScope().getRecord().get('ReleaseStartDate'),
    //       releaseEndDate = this.getContext().getTimeboxScope().getRecord().get('ReleaseDate');
    //
    //   var milestones = [];
    //
    //   if (portfolioItem && portfolioItem.Milestones && portfolioItem.Milestones._tagsNameArray && portfolioItem.Milestones._tagsNameArray.length > 0){
    //     Ext.Array.each(portfolioItem.Milestones._tagsNameArray, function(m){
    //       var targetDate = m.TargetDate && Rally.util.DateTime.fromIsoString(m.TargetDate);
    //       if (targetDate >= releaseStartDate && targetDate <= releaseEndDate){
    //           milestones.push(m);
    //       }
    //     });
    //     return milestones;
    //   }
    //   //
    //   // var parent = portfolioItem && portfolioItem.Parent || null;
    //   // if (!parent){
    //   //   //Clean up array, sort milestones in order of target date
    //   //   return _.uniq(milestones);
    //   // }
    //   // return milestones.concat(this._getMilestones(parent, portfolioItemHash));
    //
    // },
    _getFeatureFilters: function(timeboxScope, stories){
      var featureName = this.getFeatureName();

      var filters = [];
      Ext.Array.each(stories, function(s){
        console.log('s', featureName, s.get(featureName));
        if (s.get(featureName) && s.get(featureName).ObjectID){
          filters.push({
            property: 'ObjectID',
            value: s.get(featureName).ObjectID
          });
        }
      });
      var properties = ["Milestones","ObjectID"];

      this.logger.log('_getFeatureFilters', filters.length, stories);
      if (filters.length > 1){
        filters = Rally.data.wsapi.Filter.or(filters);
      } else {
        if (filters.length === 1){
          filters = Ext.create('Rally.data.wsapi.Filter',filters[0]);
        } else {
          filters = null;
        }
      }

      if (!filters || !timeboxScope.getRecord()){
        return Ext.create('Rally.data.wsapi.Filter',{
          property: 'ObjectID',
          value: 0
        });
      }

      return filters;
      // var startDate = Rally.util.DateTime.toIsoString(timeboxScope.getRecord().get('ReleaseStartDate')),
      //     endDate = Rally.util.DateTime.toIsoString(timeboxScope.getRecord().get('ReleaseDate'));
      //
      // properties = ["Milestones","TargetDate"];
      //
      // var milestoneFilters = [];
      // Ext.Array.each(this.portfolioItemTypes, function(p){
      //   var tempFilters = [{
      //     property: properties.join('.'),
      //     operator: '>=',
      //     value: startDate
      //   },{
      //     property: properties.join('.'),
      //     operator: '<=',
      //     value: endDate
      //   }];
      //   milestoneFilters.push(Rally.data.wsapi.Filter.and(tempFilters));
      //   properties.unshift("Parent");
      // });
      //
      // milestoneFilters = Rally.data.wsapi.Filter.or(milestoneFilters);
      // filters = Rally.data.wsapi.Filter.and(milestoneFilters);
      //
      // this.logger.log('_getFeatureFilters', filters.toString());
      // return filters;
    },

    _updateDisplay: function(timeboxScope){
      this.logger.log('_updateDisplay', timeboxScope.getQueryFilter());
      var filters = timeboxScope.getQueryFilter();
      this.portfolioItemRecordsByType = {};

      this._fetchWsapiRecords({
        model: 'HierarchicalRequirement',
        fetch: ['FormattedID','ObjectID','Name',this.getFeatureName()],
        filters: filters
      }).then({
          success: this._fetchFeatures,
          failure: this._showAppError,
          scope: this
      });
    },
    _fetchFeatures: function(stories){
      this.logger.log('_fetchFeatures',stories);

      var filters = [],
        featureName = this.getFeatureName();

      Ext.Array.each(stories, function(s){
        if (s.get(featureName) && s.get(featureName).ObjectID){
          filters.push({
            property: 'ObjectID',
            value: s.get(featureName).ObjectID
          });
        }
      });

      if (filters.length > 1){
        filters = Rally.data.wsapi.Filter.or(filters);
      }

      this._fetchWsapiRecords({
        model: this.portfolioItemTypes[0],
        fetch: ['FormattedID','ObjectID','Name','Milestones','Parent','TargetDate','FormattedID'],
        filters: filters,
        context: {project: null}
      }).then({
          success: this._fetchAncestors,
          failure: this._showAppError,
          scope: this
      });
    },
    _getPortfolioItemTypeOrdinal: function(recordType){
        for (var i=0; i<this.portfolioItemTypes.length; i++){
          if (this.portfolioItemTypes[i].toLowerCase() === recordType.toLowerCase()){
            return i;
          }
        }
        return i;
    },
    _fetchAncestors: function(records){
        var typeIdx = this.portfolioItemTypes.length;
        if (records && records.length > 0){
             typeIdx = this._getPortfolioItemTypeOrdinal(records[0].get('_type'));
        }
       var ancestorOids = this._getUniqueParentOids(records);
       this.logger.log('_fetchAncestors', typeIdx, records,ancestorOids);

       this.portfolioItemRecordsByType = _.reduce(records, function(hash, record){
         if (!hash[record.get('_type')]){
           hash[record.get('_type')] = {};
         }
         hash[record.get('_type')][record.get('ObjectID')] = record.getData();
         return hash;
       }, this.portfolioItemRecordsByType);

       var filters = Ext.Array.map(ancestorOids, function(a){ return {
            property: "ObjectID",
            value: a
          }
        });

        if (typeIdx + 1 >= this.portfolioItemTypes.length || ancestorOids.length ===0){
             this._buildStore(this.portfolioItemRecordsByType);
             return;
        }

       if (ancestorOids.length > 1){
           filters = Rally.data.wsapi.Filter.or(filters);
       }

        //If no records or we are at the top of the pi hierarchy, go ahead and build the grid with the data we have
        this._fetchWsapiRecords({
          model: this.portfolioItemTypes[typeIdx + 1],
          fetch: ['FormattedID','ObjectID','Name','Milestones','Parent','TargetDate'],
          filters: filters,
          context: {project: null}
        }).then({
            success: this._fetchAncestors,
            failure: this._showAppError,
            scope: this
        });
    },
    _getUniqueParentOids: function(records){
      this.logger.log('_getUniqueParentOids',records);

      var oids = [],
      featureName = this.getFeatureName();
      for (var i=0; i<records.length; i++){
        var parent = records[i].get(featureName) || records[i].get('')
        if (records[i].get('Parent')){
          oids.push(records[i].get('Parent').ObjectID);
        }
      }
      return Ext.Array.unique(oids);
    },
    _fetchPortfolioItemTypes: function(){
      return this._fetchWsapiRecords({
        model: 'TypeDefinition',
        fetch: ['Name','TypePath','Ordinal'],
        filters: [{
          property: 'TypePath',
          operator: 'contains',
          value: 'PortfolioItem/'
        }],
        sorters: [{
          property: 'Ordinal',
          direction: 'ASC'
        }]
      });
    },
    _fetchWsapiRecords: function(config){
        var deferred = Ext.create('Deft.Deferred');
        var me = this;

        if (!config.limit){ config.limit = "Infinity"; }
        if (!config.pageSize){ config.pageSize = 2000; }

        this.logger.log("Starting load:",config);

        Ext.create('Rally.data.wsapi.Store', config).load({
            callback : function(records, operation, successful) {
                if (successful){
                    deferred.resolve(records);
                } else {
                    me.logger.log("Failed: ", operation);
                    deferred.reject('Problem fetching: ' + operation.error.errors.join('. '));
                }
            }
        });
        return deferred.promise;
    },
    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },
    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    }

});
