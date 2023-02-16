'use strict'
const db = require("../models");
const User = db.users;
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
const { addNewLeagues, updateLeagues } = require('../helpers/addNewLeagues');

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

exports.boot = async (app) => {
    const state = await axios.get('https://api.sleeper.app/v1/state/nfl')
    app.set('state', state.data)

    app.set('trades_sync_counter', 0)

    app.set('users_to_update', [])

    app.set('leagues_to_add', [])

    app.set('leagues_to_update', [])

    app.set('lm_leagues_cutoff', new Date(new Date() - 60 * 1000))

    setInterval(async () => {
        const state = await axios.get('https://api.sleeper.app/v1/state/nfl')
        app.set('state', state.data)
    }, 1 * 60 * 60 * 1000)
}

exports.leaguemates = async (app) => {
    let interval = 1 * 60 * 1000

    setInterval(async () => {
        if (app.get('syncing') !== 'true') {
            console.log(`Begin Leaguemates Sync at ${new Date()}`)
            app.set('syncing', 'true')
            await updateLeaguemateLeagues(app)
            app.set('syncing', 'false')
            console.log(`Leaguemates Sync completed at ${new Date()}`)
        }

        const used = process.memoryUsage()
        for (let key in used) {
            console.log(`${key} ${Math.round(used[key] / 1024 / 1024 * 100) / 100} MB`);
        }
    }, interval)
}

exports.trades = async (app) => {
    setTimeout(() => {
        let interval = 2.5 * 60 * 1000

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
    }, 15 * 1000)
}


const updateLeaguemateLeagues = async (app) => {
    const state = app.get('state')
    const cutoff = new Date(new Date() - (1 * 24 * 60 * 60 * 1000))

    const league_ids = await getLeaguemateLeagues(app, state)

    let leagues_user_db;

    if (league_ids.length > 0) {
        try {
            leagues_user_db = await League.findAll({
                where: {
                    league_id: {
                        [Op.in]: league_ids
                    }
                }
            })
        } catch (error) {
            console.log(error)
        }
    } else {
        leagues_user_db = []
    }

    leagues_user_db = leagues_user_db.map(league => league.dataValues)

    const leagues_to_add = Array.from(new Set([
        ...app.get('leagues_to_add'),
        ...league_ids
            .filter(l => !leagues_user_db.find(l_db => l_db.league_id === l))
    ].flat()))

    const leagues_to_update = Array.from(new Set([
        ...app.get('leagues_to_update'),
        ...leagues_user_db.filter(l_db => l_db.updatedAt < cutoff).map(league => league.league_id)
    ].flat()))

    console.log(`${leagues_to_add.length} Leagues to Add... (${app.get('leagues_to_add').length} from previous)`)
    console.log(`${leagues_to_update.length} Leagues to Update... (${app.get('leagues_to_update').length} from previous)`)

    if (leagues_to_add.length > 0) {
        const leagues_to_add_batch = leagues_to_add.slice(0, 50)

        console.log(`Adding ${leagues_to_add_batch.length} Leagues`)

        const leagues_to_add_pending = leagues_to_add.filter(l => !leagues_to_add_batch.includes(l))

        app.set('leagues_to_add', leagues_to_add_pending)

        app.set('leagues_to_update', leagues_to_update)

        await addNewLeagues(axios, state, League, leagues_to_add_batch, state.league_season, true)

    } else {
        const leagues_to_update_batch = leagues_to_update.slice(0, 250)

        console.log(`Updating ${leagues_to_update_batch.length} Leagues`)

        const leagues_to_update_pending = leagues_to_update.filter(l => !leagues_to_update_batch.includes(l))

        app.set('leagues_to_update', leagues_to_update_pending)

        await updateLeagues(axios, state, League, leagues_to_update_batch, state.league_season, true)

    }
    return
}

const getLeaguemateLeagues = async (app, state) => {
    const lm_leagues_cutoff = app.get('lm_leagues_cutoff')
    app.set('lm_leagues_cutoff', new Date())

    let users_to_update = app.get('users_to_update')

    let new_users_to_update = await User.findAll({
        where: {
            updatedAt: {
                [Op.gt]: lm_leagues_cutoff
            }
        }
    })

    let all_users_to_update = Array.from(new Set([...users_to_update, ...new_users_to_update.map(user => user.dataValues.user_id)].flat()))

    let users_to_update_batch = all_users_to_update.slice(0, 500)

    console.log(`Updating ${users_to_update_batch.length} of ${all_users_to_update.length} Total Users (${users_to_update.length} Existing, ${new_users_to_update.length} New)
        : ${all_users_to_update.filter(user_id => !users_to_update_batch.includes(user_id)).length} Users pending...`)

    app.set('users_to_update', all_users_to_update.filter(user_id => !users_to_update_batch.includes(user_id)))

    let leaguemate_leagues = []

    await Promise.all(users_to_update_batch
        ?.map(async lm => {
            const lm_leagues = await axios.get(`http://api.sleeper.app/v1/user/${lm}/leagues/nfl/${state.league_season}`)

            leaguemate_leagues.push(lm_leagues.data.map(league => league.league_id))
        }))



    const leaguemate_leagues_to_update = Array.from(new Set(leaguemate_leagues.flat()))

    return leaguemate_leagues_to_update;
}

const updateTrades = async (app) => {


    const state = app.get('state')
    let i = app.get('trades_sync_counter')
    const increment = 500

    const leagues_to_update = await League.findAll({
        where: {
            season: state.league_season
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
                transactions_league = await axios.get(`https://api.sleeper.app/v1/league/${league.dataValues.league_id}/transactions/${state.season_type === 'regular' ? state.week : 1}`)
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
                        const new_roster = league.dataValues.rosters.find(x => x.roster_id === pick.owner_id)
                        const old_roster = league.dataValues.rosters.find(x => x.roster_id === pick.previous_owner_id)

                        return {
                            ...pick,
                            original_user: {
                                user_id: roster?.user_id,
                                username: roster?.username,
                                avatar: roster?.avatar,
                            },
                            new_user: {
                                user_id: new_roster?.user_id,
                                username: new_roster?.username,
                                avatar: new_roster?.avatar,
                            },
                            old_user: {
                                user_id: old_roster?.user_id,
                                username: old_roster?.username,
                                avatar: old_roster?.avatar,
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