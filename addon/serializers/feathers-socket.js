import Ember from "ember";
import DS from "ember-data";

const { getProperties } = Ember;

export default DS.JSONSerializer.extend({
  normalizeArrayResponse(store, primaryModelClass, payload/*, id, requestType*/) {
    let documentHash = {
      data: null,
      included: [],
    };

    documentHash.meta = getProperties(payload, 'skip', 'limit', 'total');
    delete payload.skip;
    delete payload.limit;
    delete payload.total;

    const payloadData = payload.data;
    const ret = new Array(payloadData.length);
    for (let i = 0, l = payloadData.length; i < l; i++) {
      let item = payloadData[i];
      let { data } = this.normalize(primaryModelClass, item);
      ret[i] = data;
    }

    documentHash.data = ret;

    return documentHash;
  },
});
