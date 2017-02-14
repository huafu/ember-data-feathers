/**
 * Created by huafu on 2/14/17.
 */
import DS from "ember-data";

const { attr } = DS;

export default DS.Model.extend({
  identities: attr(),
  username: attr('string'),
  email: attr('string'),
  password: attr('string'),
  displayName: attr('string'),
  searchableDisplayName: attr('string'),
  avatarUrl: attr('string'),
  gender: attr('string'),
  claimedAt: attr('date'),
  roles: attr(),

  createdAt: attr('date'),
  updatedAt: attr('date'),
});
