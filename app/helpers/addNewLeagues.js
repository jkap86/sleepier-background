'use strict'

const getDraftPicks = (traded_picks, rosters, users, season, drafts, league) => {
    let draft_season;
    if (!drafts.find(x => x.status === 'pre_draft' && x.settings.rounds === league.settings.draft_rounds)) {
        draft_season = parseInt(league.season) + 1
    } else {
        draft_season = parseInt(league.season)
    }

    const draft_order = drafts.find(x => x.status !== 'complete' && x.settings.rounds === league.settings.draft_rounds)?.draft_order

    let original_picks = {}

    for (let i = 0; i < rosters.length; i++) {
        original_picks[rosters[i].roster_id] = []
        for (let j = parseInt(draft_season); j <= parseInt(draft_season) + 2; j++) {

            for (let k = 1; k <= league.settings.draft_rounds; k++) {
                const original_user = users.find(u => u.user_id === rosters[i].owner_id)

                if (!traded_picks.find(pick => parseInt(pick.season) === j && pick.round === k && pick.roster_id === rosters[i].roster_id)) {
                    original_picks[rosters[i].roster_id].push({
                        season: j,
                        round: k,
                        roster_id: rosters[i].roster_id,
                        original_user: {
                            avatar: original_user?.avatar || null,
                            user_id: original_user?.user_id || '0',
                            username: original_user?.display_name || 'Orphan'
                        },
                        order: draft_order && draft_order[original_user?.user_id]
                    })
                }
            }
        }

        traded_picks.filter(x => x.owner_id === rosters[i].roster_id)
            .map(pick => {
                const original_user = users.find(u => rosters.find(r => r.roster_id === pick.roster_id)?.owner_id === u.user_id)
                return original_picks[rosters[i].roster_id].push({
                    season: parseInt(pick.season),
                    round: pick.round,
                    roster_id: pick.roster_id,
                    original_user: {
                        avatar: original_user?.avatar || null,
                        user_id: original_user?.user_id || '0',
                        username: original_user?.display_name || 'Orphan'
                    },
                    order: draft_order && draft_order[original_user?.user_id]
                })
            })

        traded_picks.filter(x => x.previous_owner_id === rosters[i].roster_id)
            .map(pick => {
                const index = original_picks[rosters[i].roster_id].findIndex(obj => {
                    return obj.season === pick.season && obj.round === pick.round && obj.roster_id === pick.roster_id
                })

                if (index !== -1) {
                    original_picks[rosters[i].roster_id].splice(index, 1)
                }
            })
    }



    return original_picks
}


const addNewLeagues = async (axios, state, League, leagues_to_add, season, sync = false) => {
    let new_leagues = []
    let j = 0;
    const increment_new = 50;

    while (j < leagues_to_add?.length) {
        let new_leagues_batch = []

        await Promise.all(leagues_to_add
            .slice(j, Math.min(j + increment_new, leagues_to_add.length))
            .map(async league_to_add => {
                let league, users, rosters, drafts, traded_picks;
                try {
                    [league, users, rosters, drafts, traded_picks] = await Promise.all([
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}/users`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}/rosters`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}/drafts`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}/traded_picks`)
                    ])
                } catch (error) {
                    console.log(error)
                }

                let draft_picks;

                if (state.league_season === season) {
                    draft_picks = getDraftPicks(traded_picks.data, rosters.data, users.data, season, drafts.data, league.data)
                }

                let matchups = {};
                if ((sync || state.league_season === season) && ['off', 'pre', 'regular'].includes(state.season_type)) {
                    const week = state.season_type === 'regular' ? state.week : 1
                    let matchups_prev_week;
                    try {
                        matchups_prev_week = await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}/matchups/${week}`)
                    } catch (error) {
                        console.log({
                            code: error.code,
                            message: error.message,
                            stack: error.stack
                        })
                    }
                    matchups[`matchups_${week}`] = matchups_prev_week?.data || []
                }

                if (league?.data) {
                    const new_league = {
                        league_id: league_to_add,
                        name: league.data.name,
                        avatar: league.data.avatar,
                        season: league.data.season,
                        best_ball: league.data.settings.best_ball,
                        type: league.data.settings.type,
                        settings: league.data.settings,
                        scoring_settings: league.data.scoring_settings,
                        roster_positions: league.data.roster_positions,
                        users: users.data.map(user => user.user_id),
                        rosters: rosters.data
                            ?.sort((a, b) => b.settings?.wins - a.settings.wins || b.settings.fpts - a.settings.fpts)
                            ?.map((roster, index) => {
                                const user = users.data.find(u => u.user_id === roster.owner_id)
                                return {
                                    rank: index + 1,
                                    taxi: roster.taxi,
                                    starters: roster.starters,
                                    settings: roster.settings,
                                    roster_id: roster.roster_id,
                                    reserve: roster.reserve,
                                    players: roster.players,
                                    user_id: roster.owner_id,
                                    username: user?.display_name,
                                    avatar: user?.avatar,
                                    co_owners: roster.co_owners?.map(co => {
                                        const co_user = users.data.find(u => u.user_id === co)
                                        return {
                                            user_id: co_user?.user_id,
                                            username: co_user?.display_name,
                                            avatar: co_user?.avatar
                                        }
                                    }),
                                    draft_picks: draft_picks[roster.roster_id]
                                }
                            }),
                        drafts: drafts?.data?.map(draft => {
                            return {
                                draft_id: draft.draft_id,
                                status: draft.status,
                                rounds: draft.settings.rounds,
                                draft_order: draft.draft_order
                            }
                        }) || [],
                        ...matchups
                    }
                    new_leagues_batch.push(new_league)

                    if (!sync) {
                        new_leagues.push(new_league)
                    } else {
                        new_leagues.push(new_league.league_id)
                    }
                }
            })
        )

        await League.bulkCreate(new_leagues_batch, {
            ignoreDuplicates: true
        })

        j += increment_new
    }

    return new_leagues
}

const updateLeagues = async (axios, state, League, leagues_to_update, season, sync = false) => {
    let keys = ["name", "avatar", "best_ball", "type", "settings", "scoring_settings", "roster_positions",
        "users", "rosters", "drafts", "updatedAt"]

    if (season === state.league_season && state.display_week > 0 && state.display_week < 19) {
        keys.push(`matchups_${state.display_week}`)
    }

    let updated_leagues = []
    let i = 0;
    const increment = 250;

    while (i < leagues_to_update?.length) {
        let updated_leagues_batch = []

        try {
            await Promise.all(leagues_to_update
                .slice(i, Math.min(i + increment, leagues_to_update.length + 1))
                .map(async league_to_update => {
                    const [league, users, rosters, traded_picks] = await Promise.all([
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}/users`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}/rosters`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}/traded_picks`)

                    ])
                    let drafts;

                    if (!['in_season', 'complete'].includes(league_to_update.status)) {
                        drafts = await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}/drafts`)
                    }

                    let draft_picks;

                    if (state.league_season === season) {
                        draft_picks = getDraftPicks(traded_picks.data, rosters.data, users.data, season, drafts.data || [], league.data)
                    }

                    let matchups;

                    if (season === state.league_season && state.season_type !== 'post') {
                        try {
                            matchups = await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}/matchups/${state.display_week}`)
                        } catch (error) {
                            console.log(error)
                            matchups = {
                                data: []
                            }
                        }

                    }
                    let updated_league = {
                        league_id: league_to_update,
                        name: league.data.name,
                        avatar: league.data.avatar,
                        season: league.data.season,
                        best_ball: league.data.settings.best_ball,
                        type: league.data.settings.type,
                        settings: league.data.settings,
                        scoring_settings: league.data.scoring_settings,
                        roster_positions: league.data.roster_positions,
                        users: users.data.map(user => user.user_id),
                        rosters: rosters.data
                            .sort((a, b) => b.settings?.wins - a.settings.wins || b.settings.fpts - a.settings.fpts)
                            .map((roster, index) => {
                                const user = users.data.find(u => u.user_id === roster.owner_id)
                                return {
                                    rank: index + 1,
                                    taxi: roster.taxi,
                                    starters: roster.starters,
                                    settings: roster.settings,
                                    roster_id: roster.roster_id,
                                    reserve: roster.reserve,
                                    players: roster.players,
                                    user_id: roster.owner_id,
                                    username: user?.display_name,
                                    avatar: user?.avatar,
                                    co_owners: roster.co_owners?.map(co => {
                                        const co_user = users.data.find(u => u.user_id === co)
                                        return {
                                            user_id: co_user?.user_id,
                                            username: co_user?.display_name,
                                            avatar: co_user?.avatar
                                        }
                                    }),
                                    draft_picks: draft_picks[roster.roster_id]
                                }
                            }),
                        draft_picks: draft_picks,
                        drafts: drafts?.data?.map(draft => {
                            return {
                                draft_id: draft.draft_id,
                                status: draft.status,
                                rounds: draft.settings.rounds,
                                draft_order: draft.draft_order
                            }
                        }) || [],
                        [`matchups_${state.display_week}`]: matchups.data || [],
                        updatedAt: Date.now()
                    }

                    updated_leagues_batch.push(updated_league)

                    if (!sync) {
                        updated_leagues.push(updated_league)
                    } else {
                        updated_leagues.push(updated_league.league_id)
                    }
                })
            )
        } catch (error) {
            console.log(error)
        }

        await League.bulkCreate(updated_leagues_batch, {
            updateOnDuplicate: keys
        })

        i += increment
    }

    return updated_leagues;
}

module.exports = {
    addNewLeagues: addNewLeagues,
    updateLeagues: updateLeagues
}