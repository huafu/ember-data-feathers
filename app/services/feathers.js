import FeathersService from "ember-data-feathers/services/feathers";
import config from "../config/environment";

export default FeathersService.extend({ appConfig: config });
