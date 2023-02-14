'use strict'
const db = require("../models");
const League = db.leagues;
const Trade = db.trades;
const Op = db.Sequelize.Op;
const https = require('https');
const axios = require('axios').create({
    headers: {
        'content-type': 'application/json'
    },
    httpsAgent: new https.Agent({ rejectUnauthorized: false, keepAlive: true }),
    timeout: 10000
});
const axiosRetry = require('axios-retry');

axiosRetry(axios, {
    retries: 3,
    retryCondition: (error) => {
        return error.code === 'ECONNABORTED' || error.code === 'ERR_BAD_REQUEST' ||
            axiosRetry.isNetworkError(error) || axiosRetry.isRetryableError(error);
    },
    retryDelay: (retryCount) => {
        return retryCount * 3000
    },
    shouldResetTimeout: true
})

exports.trades = async (app) => {
    let interval = 1 * 60 * 1000

    setInterval(async () => {
        if (app.get('syncing') !== 'true') {
            console.log(`Begin Transactions Sync at ${new Date()}`)
            app.set('syncing', 'true')
            await updateTrades(app)
            app.set('syncing', 'false')
            console.log(`Transactions Sync completed at ${new Date()}`)
        }

        const used = process.memoryUsage()
        for (let key in used) {
            console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
        }
    }, interval)
}


const updateTrades = async (app) => {


    const state = await axios.get('https://api.sleeper.app/v1/state/nfl')
    let i = app.get('trades_sync_counter') || 0
    const increment = 500

    const leagues_to_update = await League.findAll({
        where: {
            season: state.data.league_season
        },
        order: [['createdAt', 'ASC']],
        offset: i,
        limit: increment
    })

    console.log(`Updating trades for ${i + 1}-${Math.min(i + 1 + increment, i + leagues_to_update.length)} Leagues...`)

    let transactions_week = []

    await Promise.all(leagues_to_update
        .filter(x => x.dataValues.rosters)
        .map(async league => {
            let transactions_league;

            try {
                transactions_league = await axios.get(`https://api.sleeper.app/v1/league/${league.dataValues.league_id}/transactions/${state.data.season_type === 'regular' ? state.data.week : 1}`)
            } catch (error) {
                console.log(error)
                transactions_league = {
                    data: []
                }
            }

            return transactions_league.data
                .map(transaction => {
                    const draft_order = league.drafts.find(d => d.draft_order && d.status !== 'complete')?.draft_order
                    const managers = transaction.roster_ids.map(roster_id => {
                        const user = league.dataValues.rosters?.find(x => x.roster_id === roster_id)

                        return user?.user_id
                    })

                    const draft_picks = transaction.draft_picks.map(pick => {
                        const roster = league.dataValues.rosters.find(x => x.roster_id === pick.roster_id)

                        return {
                            ...pick,
                            original_user: {
                                user_id: roster?.user_id,
                                username: roster?.username,
                                avatar: roster?.avatar,
                            },
                            order: draft_order && roster?.user_id ? draft_order[roster?.user_id] : null
                        }
                    })

                    let adds = {}
                    transaction.adds && Object.keys(transaction.adds).map(add => {
                        const user = league.dataValues.rosters?.find(x => x.roster_id === transaction.adds[add])
                        return adds[add] = user?.user_id
                    })

                    let drops = {}
                    transaction.drops && Object.keys(transaction.drops).map(drop => {
                        const user = league.dataValues.rosters?.find(x => x.roster_id === transaction.drops[drop])
                        return drops[drop] = user?.user_id
                    })

                    if (transaction.type === 'trade' && transaction.adds) {
                        return transactions_week.push({
                            transaction_id: transaction.transaction_id,
                            status_updated: transaction.status_updated,
                            managers: managers,
                            adds: adds,
                            drops: drops,
                            draft_picks: draft_picks,
                            league: {
                                league_id: league.league_id,
                                name: league.name,
                                avatar: league.avatar,
                                best_ball: league.best_ball,
                                type: league.type,
                                roster_positions: league.roster_positions,
                                scoring_settings: league.scoring_settings

                            },
                            users: league.users,
                            rosters: league.rosters,
                            drafts: league.drafts
                        })
                    }

                })
        })
    )

    Trade.bulkCreate(transactions_week, { updateOnDuplicate: ['manager', 'adds', 'drops', 'draft_picks', 'league', 'users', 'rosters', 'drafts'] })

    if (leagues_to_update.length < increment) {
        app.set('trades_sync_counter', 0)
    } else {
        app.set('trades_sync_counter', i + increment)
    }


    return
}