import {
  checkRendering,
  warning,
  createDocumentationMessageGenerator,
  createSendEventForFacet,
  isEqual,
  noop,
} from '../../lib/utils';

const withUsage = createDocumentationMessageGenerator({
  name: 'hierarchical-menu',
  connector: true,
});

/**
 * @typedef {Object} HierarchicalMenuItem
 * @property {string} value Value of the menu item.
 * @property {string} label Human-readable value of the menu item.
 * @property {number} count Number of matched results after refinement is applied.
 * @property {isRefined} boolean Indicates if the refinement is applied.
 * @property {Object} [data = undefined] n+1 level of items, same structure HierarchicalMenuItem (default: `undefined`).
 */

/**
 * @typedef {Object} CustomHierarchicalMenuWidgetOptions
 * @property {string[]} attributes Attributes to use to generate the hierarchy of the menu.
 * @property {string} [separator = '>'] Separator used in the attributes to separate level values.
 * @property {string} [rootPath = null] Prefix path to use if the first level is not the root level.
 * @property {boolean} [showParentLevel=false] Show the siblings of the selected parent levels of the current refined value. This
 * does not impact the root level.
 * @property {number} [limit = 10] Max number of values to display.
 * @property {boolean} [showMore = false] Whether to display the "show more" button.
 * @property {number} [showMoreLimit = 20] Max number of values to display when showing more.
 * @property  {string[]|function} [sortBy = ['name:asc']] How to sort refinements. Possible values: `count|isRefined|name:asc|name:desc`.
 *
 * You can also use a sort function that behaves like the standard Javascript [compareFunction](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#Syntax).
 * @property {function(object[]):object[]} [transformItems] Function to transform the items passed to the templates.
 */

/**
 * @typedef {Object} HierarchicalMenuRenderingOptions
 * @property {function(item.value): string} createURL Creates an url for the next state for a clicked item.
 * @property {HierarchicalMenuItem[]} items Values to be rendered.
 * @property {function(item.value)} refine Sets the path of the hierarchical filter and triggers a new search.
 * @property {Object} widgetParams All original `CustomHierarchicalMenuWidgetOptions` forwarded to the `renderFn`.
 */

/**
 * **HierarchicalMenu** connector provides the logic to build a custom widget
 * that will give the user the ability to explore facets in a tree-like structure.
 *
 * This is commonly used for multi-level categorization of products on e-commerce
 * websites. From a UX point of view, we suggest not displaying more than two
 * levels deep.
 *
 * @type {Connector}
 * @param {function(HierarchicalMenuRenderingOptions, boolean)} renderFn Rendering function for the custom **HierarchicalMenu** widget.
 * @param {function} unmountFn Unmount function called when the widget is disposed.
 * @return {function(CustomHierarchicalMenuWidgetOptions)} Re-usable widget factory for a custom **HierarchicalMenu** widget.
 */
export default function connectHierarchicalMenu(renderFn, unmountFn = noop) {
  checkRendering(renderFn, withUsage());

  return (widgetParams = {}) => {
    const {
      attributes,
      separator = ' > ',
      rootPath = null,
      showParentLevel = true,
      limit = 10,
      showMore = false,
      showMoreLimit = 20,
      sortBy = ['name:asc'],
      transformItems = items => items,
    } = widgetParams;

    if (!attributes || !Array.isArray(attributes) || attributes.length === 0) {
      throw new Error(
        withUsage('The `attributes` option expects an array of strings.')
      );
    }

    if (showMore === true && showMoreLimit <= limit) {
      throw new Error(
        withUsage('The `showMoreLimit` option must be greater than `limit`.')
      );
    }

    // we need to provide a hierarchicalFacet name for the search state
    // so that we can always map $hierarchicalFacetName => real attributes
    // we use the first attribute name
    const [hierarchicalFacetName] = attributes;
    let sendEvent;

    // Provide the same function to the `renderFn` so that way the user
    // has to only bind it once when `isFirstRendering` for instance
    let toggleShowMore = () => {};
    function cachedToggleShowMore() {
      toggleShowMore();
    }

    return {
      $$type: 'ais.hierarchicalMenu',

      isShowingMore: false,

      createToggleShowMore(renderOptions) {
        return () => {
          this.isShowingMore = !this.isShowingMore;
          this.render(renderOptions);
        };
      },

      getLimit() {
        return this.isShowingMore ? showMoreLimit : limit;
      },

      init(initOptions) {
        const { instantSearchInstance } = initOptions;

        renderFn(
          {
            ...this.getWidgetRenderState(initOptions),
            instantSearchInstance,
          },
          true
        );
      },

      _prepareFacetValues(facetValues) {
        return facetValues
          .slice(0, this.getLimit())
          .map(({ name: label, path: value, ...subValue }) => {
            if (Array.isArray(subValue.data)) {
              subValue.data = this._prepareFacetValues(subValue.data);
            }
            return { ...subValue, label, value };
          });
      },

      render(renderOptions) {
        const { instantSearchInstance } = renderOptions;

        toggleShowMore = this.createToggleShowMore(renderOptions);

        renderFn(
          {
            ...this.getWidgetRenderState(renderOptions),
            instantSearchInstance,
          },
          false
        );
      },

      /**
       * @param {Object} param0 cleanup arguments
       * @param {any} param0.state current search parameters
       * @returns {any} next search parameters
       */
      dispose({ state }) {
        unmountFn();

        return state
          .removeHierarchicalFacet(hierarchicalFacetName)
          .setQueryParameter('maxValuesPerFacet', undefined);
      },

      getRenderState(renderState, renderOptions) {
        return {
          ...renderState,
          hierarchicalMenu: {
            ...renderState.hierarchicalMenu,
            [hierarchicalFacetName]: this.getWidgetRenderState(renderOptions),
          },
        };
      },

      getWidgetRenderState({
        results,
        state,
        createURL,
        instantSearchInstance,
        helper,
      }) {
        // Bind createURL to this specific attribute
        function _createURL(facetValue) {
          return createURL(
            state.toggleRefinement(hierarchicalFacetName, facetValue)
          );
        }

        if (!sendEvent) {
          sendEvent = createSendEventForFacet({
            instantSearchInstance,
            helper,
            attribute: hierarchicalFacetName,
            widgetType: this.$$type,
          });
        }

        if (!this._refine) {
          this._refine = function(facetValue) {
            sendEvent('click', facetValue);
            helper.toggleRefinement(hierarchicalFacetName, facetValue).search();
          };
        }

        const facetValues = results
          ? results.getFacetValues(hierarchicalFacetName, { sortBy }).data || []
          : [];
        const items = transformItems(
          results ? this._prepareFacetValues(facetValues) : []
        );

        const getHasExhaustiveItems = () => {
          if (!results) {
            return false;
          }

          const currentLimit = this.getLimit();
          // If the limit is the max number of facet retrieved it is impossible to know
          // if the facets are exhaustive. The only moment we are sure it is exhaustive
          // is when it is strictly under the number requested unless we know that another
          // widget has requested more values (maxValuesPerFacet > getLimit()).
          // Because this is used for making the search of facets unable or not, it is important
          // to be conservative here.
          return state.maxValuesPerFacet > currentLimit
            ? facetValues.length <= currentLimit
            : facetValues.length < currentLimit;
        };

        return {
          items,
          refine: this._refine,
          createURL: _createURL,
          sendEvent,
          widgetParams,
          isShowingMore: this.isShowingMore,
          toggleShowMore: cachedToggleShowMore,
          canToggleShowMore:
            showMore && (this.isShowingMore || !getHasExhaustiveItems()),
        };
      },

      getWidgetUiState(uiState, { searchParameters }) {
        const path = searchParameters.getHierarchicalFacetBreadcrumb(
          hierarchicalFacetName
        );

        if (!path.length) {
          return uiState;
        }

        return {
          ...uiState,
          hierarchicalMenu: {
            ...uiState.hierarchicalMenu,
            [hierarchicalFacetName]: path,
          },
        };
      },

      getWidgetSearchParameters(searchParameters, { uiState }) {
        const values =
          uiState.hierarchicalMenu &&
          uiState.hierarchicalMenu[hierarchicalFacetName];

        if (searchParameters.isHierarchicalFacet(hierarchicalFacetName)) {
          const facet = searchParameters.getHierarchicalFacetByName(
            hierarchicalFacetName
          );

          warning(
            isEqual(facet.attributes, attributes) &&
              facet.separator === separator &&
              facet.rootPath === rootPath,
            'Using Breadcrumb and HierarchicalMenu on the same facet with different options overrides the configuration of the HierarchicalMenu.'
          );
        }

        const withFacetConfiguration = searchParameters
          .removeHierarchicalFacet(hierarchicalFacetName)
          .addHierarchicalFacet({
            name: hierarchicalFacetName,
            attributes,
            separator,
            rootPath,
            showParentLevel,
          });

        const currentMaxValuesPerFacet =
          withFacetConfiguration.maxValuesPerFacet || 0;

        const nextMaxValuesPerFacet = Math.max(
          currentMaxValuesPerFacet,
          showMore ? showMoreLimit : limit
        );

        const withMaxValuesPerFacet = withFacetConfiguration.setQueryParameter(
          'maxValuesPerFacet',
          nextMaxValuesPerFacet
        );

        if (!values) {
          return withMaxValuesPerFacet.setQueryParameters({
            hierarchicalFacetsRefinements: {
              ...withMaxValuesPerFacet.hierarchicalFacetsRefinements,
              [hierarchicalFacetName]: [],
            },
          });
        }

        return withMaxValuesPerFacet.addHierarchicalFacetRefinement(
          hierarchicalFacetName,
          values.join(separator)
        );
      },
    };
  };
}
