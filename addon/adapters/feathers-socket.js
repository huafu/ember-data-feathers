import Ember from "ember";
import DS from "ember-data";

const { inject, RSVP, run, computed, assert } = Ember;

const METHODS_MAP = {
  create: { eventType: 'created', lock: true },
  update: { eventType: 'updated', lock: false },
  patch: { eventType: 'patched', lock: false },
  remove: { eventType: 'removed', lock: true },
};

export default DS.Adapter.extend({
  defaultSerializer: '-feathers-socket',

  feathers: inject.service(),

  init() {
    this._super(...arguments);
    this.debug = this.get('feathers').debug;
  },

  // required methods when extending an adapter ===============================

  findRecord(store, type, id/*, snapshot*/) {
    return this.serviceCall(type, 'get', id);
  },

  createRecord(store, type, snapshot) {
    const data = this.serialize(snapshot, { includeId: true });
    return this.serviceCall(type, 'create', data);
  },

  updateRecord(store, type, snapshot) {
    const data = this.serialize(snapshot, { includeId: true });
    return this.serviceCall(type, 'update', snapshot.id, data);
  },

  deleteRecord(store, type, snapshot) {
    //const data = this.serialize(snapshot, { includeId: true });
    return this.serviceCall(type, 'remove', snapshot.id);
  },

  findAll() {

  },

  query() {

  },

  /*findMany() {

   },*/

  // end of required methods ==================================================


  feathersServiceFor(modelName) {
    return this.get('feathers').serviceForModel(modelName);
  },

  serviceCall(type, method, ...args) {
    const service = this.feathersServiceFor(type.modelName);
    return new RSVP.Promise((resolve, reject) => {
      service[method](...args).then(
        run.bind(this, 'handleServiceResponse', type, method, resolve),
        run.bind(this, 'handleServiceError', type, method, reject)
      );
    });
  },

  handleServiceResponse(type, method, resolver, data) {
    if (METHODS_MAP.hasOwnProperty(method) && METHODS_MAP[method].lock) {
      this.discardOnce(type.modelName, METHODS_MAP[method].eventType, data);
    }
    resolver(data);
  },

  handleServiceError(type, method, rejecter, error) {
    rejecter(error);
  },

  handleServiceEvent(eventType, modelName, message) {
    if (this.shouldDiscard(modelName, eventType, message, true)) {
      this.debug && this.debug(`[${modelName}] discarding one ${eventType} message: %O`, message);
      return;
    }

    const store = this.get('store');
    let id, record;

    switch (eventType) {
      case 'created':
        store.pushPayload(modelName, message);
        break;

      case 'updated':
        store.pushPayload(modelName, message);
        break;

      case 'patched':
        assert('Patch event is not handled yet');
        break;

      case 'deleted':
        id = message[this.primaryKeyOf(modelName)];
        assert('The incoming message must have the id of deleted record but none was found', id);
        record = store.peekRecord(modelName, id);
        record && store.unloadRecord(record);
        break;

      default:
        assert(`Unknown event type: ${eventType}`);
    }
  },

  discarded: computed({
    get() {
      return {
        created: Object.create(null),
        updated: Object.create(null),
        patched: Object.create(null),
        deleted: Object.create(null),
      };
    }
  }).readOnly(),

  discardOnce(modelName, eventType, data) {
    const { discarded, key } = this.discardedMeta(modelName, eventType, data);
    if (discarded[key]) {
      discarded[key]++;
    } else {
      discarded[key] = 1;
    }
  },

  shouldDiscard(modelName, eventType, data, willDiscard = false) {
    const { discarded, key } = this.discardedMeta(modelName, eventType, data);
    let shouldDiscard = (discarded[key] || 0) > 0;

    if (shouldDiscard && willDiscard) {
      if (--discarded[key] === 0) {
        delete discarded[key];
      }
    }

    return shouldDiscard;
  },


  discardedMeta(modelName, eventType, data) {
    const discarded = this.get('discarded')[eventType];
    const id = data[this.primaryKeyOf(modelName)];
    const key = modelName + ':' + id;
    assert("Returned message should have an id", id);
    return { discarded, key };
  },

  primaryKeyOf(modelName) {
    const cache = this._primaryKeyOf || (this._primaryKeyOf = Object.create(null));
    if (!cache[modelName]) {
      return cache[modelName] = this.get('store').serializerFor(modelName).primaryKey;
    }
    return cache[modelName];
  },
});
