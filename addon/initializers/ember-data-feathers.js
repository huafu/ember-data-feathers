import FeathersSocketAdapter from "../adapters/feathers-socket";
import FeathersSocketSerializer from "../serializers/feathers-socket";

export function initialize(application) {
  application.register('adapter:-feathers-socket', FeathersSocketAdapter);
  application.register('serializer:-feathers-socket', FeathersSocketSerializer);
  application.register('serializer:-feathers-socket', FeathersSocketSerializer);
}

export default {
  name: 'ember-data-feathers',
  before: 'ember-data',
  initialize,
};
