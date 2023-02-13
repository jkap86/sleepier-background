'use strict'

module.exports = app => {
    const syncs = require("../controllers/sync.controller.js");

    syncs.trades(app)
}