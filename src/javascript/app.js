Ext.define("cats-milestone-by-release", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    defaults: { margin: 10 },

    integrationHeaders : {
        name : "cats-milestone-by-release"
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

    _clearAppMessage: function(){
      if (this.down('#appMessage')){
        this.down('#appMessage').destroy();
      }
    },

    onTimeboxScopeChange: function(timeboxScope){
        this.getContext().setTimeboxScope(timeboxScope);
        this.logger.log('onTimeboxScopeChange', timeboxScope, timeboxScope.getRecord());

      if (timeboxScope && timeboxScope.getType() === 'release'){
        this._updateDisplay(timeboxScope);
      } else {
        this._addAppMessage("This app is designed to run on a dashboard with a Release timebox selector.")
      }
    },

    _buildStore: function(portfolioItems){
      this.logger.log('_buildStore', portfolioItems);

      var data = [];
      Ext.Object.each(portfolioItems[this.portfolioItemTypes[0].toLowerCase()], function(objectID, recData){
        var milestones = this._getMilestones(recData, portfolioItems);
        var row = recData;
        row.Milestones = milestones;
        data.push(row);
      }, this);
      this.logger.log('_buildStore', data);
      var store = Ext.create('Rally.data.custom.Store',{
         data: data,
         fields: ['FormattedID','Name','Milestones',"_ref","_type"],
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
      }];

    },

    _getMilestones: function(item, portfolioItemHash){
      var type = item._type && item._type.toLowerCase(),
          portfolioItem = portfolioItemHash[type][item.ObjectID],
          releaseStartDate = this.getContext().getTimeboxScope().getRecord().get('ReleaseStartDate'),
          releaseEndDate = this.getContext().getTimeboxScope().getRecord().get('ReleaseDate');

      var milestones = [];
      if (portfolioItem && portfolioItem.Milestones && portfolioItem.Milestones._tagsNameArray && portfolioItem.Milestones._tagsNameArray.length > 0){
        Ext.Array.each(portfolioItem.Milestones._tagsNameArray, function(m){
          var targetDate = m.TargetDate && Rally.util.DateTime.fromIsoString(m.TargetDate);
          if (targetDate >= releaseStartDate && targetDate <= releaseEndDate){
              milestones.push(m);
          }
        });
      }

      var parent = portfolioItem && portfolioItem.Parent || null;
      if (!parent){
        //Clean up array, sort milestones in order of target date
        return _.uniq(milestones);
      }
      return milestones.concat(this._getMilestones(parent, portfolioItemHash));

    },
    _getFeatureFilters: function(timeboxScope){
      var filters = [],
          properties = ["Milestones","ObjectID"];

      if (timeboxScope.getRecord() === null){

        Ext.Array.each(this.portfolioItemTypes, function(p){
          filters.push({
            property: properties.join('.'),
            operator: '>',
            value: 0
          });
          properties.unshift("Parent")
        });

        filters = Rally.data.wsapi.Filter.or(filters);

      } else {

          var startDate = Rally.util.DateTime.toIsoString(timeboxScope.getRecord().get('ReleaseStartDate')),
              endDate = Rally.util.DateTime.toIsoString(timeboxScope.getRecord().get('ReleaseDate'));

          properties = ["Milestones","TargetDate"];
          Ext.Array.each(this.portfolioItemTypes, function(p){
            var tempFilters = [{
              property: properties.join('.'),
              operator: '>=',
              value: startDate
            },{
              property: properties.join('.'),
              operator: '<=',
              value: endDate
            }];
            filters.push(Rally.data.wsapi.Filter.and(tempFilters));
            properties.unshift("Parent");
          });

          filters = Rally.data.wsapi.Filter.or(filters);
      }
      filters = filters.and(timeboxScope.getQueryFilter());
      this.logger.log('_getFeatureFilters', filters.toString());
      return filters;
    },

    _updateDisplay: function(timeboxScope){
      this.logger.log('_updateDisplay', timeboxScope.getQueryFilter());
      var filters = this._getFeatureFilters(timeboxScope);

      this._fetchWsapiRecords({
        model: this.portfolioItemTypes[0],
        fetch: ['FormattedID','ObjectID','Name','Milestones','Parent','TargetDate'],
        filters: filters
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

        //If no records or we are at the top of the pi hierarchy, go ahead and build the grid with the data we have
        if (typeIdx + 1 === this.portfolioItemTypes.length || ancestorOids.length ===0){
             this._buildStore(this.portfolioItemRecordsByType);
             return;
        }

        var filters = Ext.Array.map(ancestorOids, function(a){ return {
             property: "ObjectID",
             value: a
           }
         });
        if (ancestorOids.length > 1){
            filters = Rally.data.wsapi.Filter.or(filters);
        }

        this._fetchWsapiRecords({
          model: this.portfolioItemTypes[typeIdx + 1],
          fetch: ['FormattedID','ObjectID','Name','Milestones','Parent','TargetDate'],
          filters: filters
        }).then({
            success: this._fetchAncestors,
            failure: this._showAppError,
            scope: this
        });
    },
    _getUniqueParentOids: function(records){
      this.logger.log('_getUniqueParentOids',records);

      var oids = [];
      for (var i=0; i<records.length; i++){
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
