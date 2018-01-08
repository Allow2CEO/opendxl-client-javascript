'use strict'

var DxlError = require('./dxl_error')
var Request = require('./request')

var DXL_SERVICE_REGISTER_REQUEST_TOPIC =
  '/mcafee/service/dxl/svcregistry/register'
var DXL_SERVICE_UNREGISTER_REQUEST_TOPIC =
  '/mcafee/service/dxl/svcregistry/unregister'

function ServiceManager (client) {
  this.client = client
  this.services = {}
}

function clearTtlTimeout (service) {
  if (service.ttlTimeout) {
    clearTimeout(service.ttlTimeout)
  }
}

function registerService (client, service) {
  clearTtlTimeout(service)

  if (client.connected) {
    var request = new Request(DXL_SERVICE_REGISTER_REQUEST_TOPIC)
    request.payload = JSON.stringify({
      serviceType: service.info.serviceType,
      metaData: service.info.metadata,
      requestChannels: service.info.topics,
      ttlMins: service.info.ttl,
      serviceGuid: service.info.serviceId
    })
    request.destinationTenantGuids = service.info.destinationTenantGuids

    client.asyncRequest(request,
      function (error, response) {
        if (service.onFirstRegistrationCallback) {
          service.onFirstRegistrationCallback(error, response)
          service.onFirstRegistrationCallback = null
        }
      })

    service.ttlTimeout = setTimeout(registerService,
      service.info.ttl * 60 * 1000, client, service)
  }
}

function unregisterService (client, service, callback) {
  if (client.connected) {
    var request = new Request(DXL_SERVICE_UNREGISTER_REQUEST_TOPIC)
    request.payload = JSON.stringify({
      serviceGuid: service.info.serviceId})
    var unregisterCallback = null
    if (callback) {
      unregisterCallback = function (error, response) {
        callback(error, response)
      }
    }
    client.asyncRequest(request, unregisterCallback)
  }

  service.info.topics.forEach(function (topic) {
    service.info.callbacks(topic).forEach(function (callback) {
      client.removeRequestCallback(topic, callback)
    })
  })

  clearTtlTimeout(service)
}

ServiceManager.prototype.registerServiceAsync = function (
  serviceRegInfo, registrationCallback) {
  var that = this

  var service = {
    info: serviceRegInfo,
    onFirstRegistrationCallback: registrationCallback,
    ttlTimeout: null
  }

  if (this.services[serviceRegInfo.serviceId]) {
    throw new DxlError('Service already registered for id: ' +
      serviceRegInfo.serviceId)
  }
  this.services[serviceRegInfo.serviceId] = service

  registerService(this.client, service)

  serviceRegInfo.topics.forEach(function (topic) {
    serviceRegInfo.callbacks(topic).forEach(function (callback) {
      that.client.addRequestCallback(topic, callback, true)
    })
  })
}

ServiceManager.prototype.unregisterServiceAsync = function (
  serviceRegInfo, unregistrationCallback) {
  var service = this.services[serviceRegInfo.serviceId]
  if (service) {
    delete this.services[serviceRegInfo.serviceId]
    unregisterService(this.client, service, unregistrationCallback)
  }
}

ServiceManager.prototype.onConnected = function () {
  var that = this

  Object.keys(this.services).forEach(function (serviceId) {
    registerService(that.client, that.services[serviceId])
  })
}

ServiceManager.prototype.destroy = function () {
  var that = this
  Object.keys(this.services).forEach(function (serviceId) {
    unregisterService(that.client, that.services[serviceId])
  })
  this.services = {}
}

module.exports = ServiceManager