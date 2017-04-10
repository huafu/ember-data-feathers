import Ember from 'ember';
import DS from 'ember-data';

const { assert } = Ember;


export function extend(ParentErrorClass, defaultMessage) {
  if (ParentErrorClass.extend) {
    return ParentErrorClass.extend({ message: defaultMessage });
  }
  let ErrorClass = function (errors, message) {
    assert('`AdapterError` expects json-api formatted errors array.', Array.isArray(errors || []));
    ParentErrorClass.call(this, errors, message || defaultMessage);
  };
  ErrorClass.prototype = Object.create(ParentErrorClass.prototype);

  return ErrorClass;
}


export const NotAuthenticated = extend(
  DS.UnauthorizedError || DS.AdapterError,
  'The adapter operation is unauthorized'
);
export const Forbidden = extend(DS.ForbiddenError || DS.AdapterError, 'The adapter operation is forbidden');
export const BadRequest = extend(DS.InvalidError);
export const PaymentError = extend(DS.AdapterError, 'The adapter operation failed due to a payment error');
export const NotFound = extend(DS.NotFoundError || DS.AdapterError, 'The adapter could not find the resource');
export const MethodNotAllowed = extend(DS.ForbiddenError || DS.AdapterError, 'The adapter method is not allowed');
export const NotAcceptable = extend(DS.AdapterError, 'The adapter sent unacceptable data');
export const Timeout = extend(DS.TimeoutError);
export const Conflict = extend(DS.ConflictError || DS.AdapterError, 'The adapter operation failed due to a conflict');
export const LengthRequired = extend(DS.AdapterError, 'The adapter operation failed due to a missing request length');
export const Unprocessable = extend(DS.InvalidError, 'The adapter rejected the commit due to semantic errors');
export const TooManyRequests = extend(
  DS.AdapterError,
  'The adapter operation failed because the rate limit has been reached'
);
export const GeneralError = extend(
  DS.ServerError || DS.AdapterError,
  'The adapter operation failed due to a server error'
);
export const NotImplemented = extend(
  DS.ServerError || DS.AdapterError,
  'The adapter operation failed due to the lack of its implementation on the server'
);
export const BadGateway = extend(
  DS.ServerError || DS.AdapterError,
  'The server was acting as a gateway and received an invalid response from the upstream server'
);
export const Unavailable = extend(
  DS.AdapterError,
  'The adapter operation failed because the server is down for maintenance'
);


export default {
  NotAuthenticated,
  Forbidden,
  BadRequest,
  PaymentError,
  NotFound,
  MethodNotAllowed,
  NotAcceptable,
  Timeout,
  Conflict,
  LengthRequired,
  Unprocessable,
  TooManyRequests,
  GeneralError,
  NotImplemented,
  BadGateway,
  Unavailable,
};
