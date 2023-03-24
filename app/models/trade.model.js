'use strict'

const { DataTypes } = require("sequelize");

module.exports = (sequelize, Sequelize) => {
    const Trade = sequelize.define("trade", {
        transaction_id: {
            type: Sequelize.STRING,
            allowNull: false,
            primaryKey: true
        },
        league: {
            type: Sequelize.JSONB
        },
        users: {
            type: Sequelize.JSONB,
        },
        rosters: {
            type: Sequelize.JSONB,
        },
        status_updated: {
            type: Sequelize.STRING
        },
        managers: {
            type: DataTypes.ARRAY(DataTypes.STRING)
        },
        adds: {
            type: Sequelize.JSONB
        },
        drops: {
            type: Sequelize.JSONB
        },
        draft_picks: {
            type: Sequelize.JSONB
        },
        drafts: {
            type: Sequelize.JSONB
        }
    });

    return Trade;
};