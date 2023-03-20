'use strict'

const db = require("../models");
const League = db.leagues;
const Op = db.Sequelize.Op;

const getPlayerShares = async (user_id) => {
    let leagues_user_db = await League.findAll({
        where: {
            users: {
                [Op.contains]: user_id
            }
        }
    })

    leagues_user_db = leagues_user_db.map(league => league.dataValues)

    let players_all = {}

    leagues_user_db.map(league => {
        const roster = league.rosters.find(r => r.user_id === user_id || r.co_owners?.find(co => co.user_id === user_id))
        if (roster?.players) {
            roster.players.map(player_id => {
                if (players_all[player_id]) {
                    players_all[player_id].push(league.league_id)
                } else {
                    players_all[player_id] = [league.league_id]
                }
            })
        }
    })

    return players_all
}

module.exports = {
    getPlayerShares: getPlayerShares
}