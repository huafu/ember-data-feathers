import Ember from "ember";
import DS from "ember-data";

const { getProperties, isArray } = Ember;

export default DS.JSONSerializer.extend({
  primaryKey: '_id',

  normalizeArrayResponse(store, primaryModelClass, payload/*, id, requestType*/) {
    let items;
    let documentHash = {
      data: null,
      included: [],
    };

    if (payload.data && isArray(payload.data)) {
      documentHash.meta = getProperties(payload, 'skip', 'limit', 'total');
      delete payload.skip;
      delete payload.limit;
      delete payload.total;
      items = payload.data;
    } else {
      items = payload;
    }

    const ret = new Array(items.length);
    for (let i = 0, l = items.length; i < l; i++) {
      let item = items[i];
      let { data, included } = this.normalize(primaryModelClass, item);
      if (included) {
        documentHash.included.push(...included);
      }
      ret[i] = data;
    }
    documentHash.data = ret;

    return documentHash;
  },
});
