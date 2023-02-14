'use strict'

const addNewLeagues = async (axios, state, League, leagues_to_add, season, sync = false) => {
    let new_leagues = []
    let j = 0;
    const increment_new = 50;

    while (j < leagues_to_add?.length) {
        let new_leagues_batch = []

        await Promise.all(leagues_to_add
            .slice(j, Math.min(j + increment_new, leagues_to_add.length))
            .map(async league_to_add => {
                let league, users, rosters, drafts;
                try {
                    [league, users, rosters, drafts] = await Promise.all([
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}/users`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}/rosters`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}/drafts`),
                    ])
                } catch (error) {
                    console.log(error)
                }

                const weeks = (state.league_season === season && state.season_type === 'regular') ? state.week
                    : state.league_season > season ? 18
                        : 0

                let matchups = {};

                await Promise.all(Array.from(Array(weeks).keys()).map(async key => {
                    let matchups_prev_week;
                    try {
                        matchups_prev_week = await axios.get(`https://api.sleeper.app/v1/league/${league_to_add}/matchups/${key + 1}`)
                    } catch (error) {
                        console.log({
                            code: error.code,
                            message: error.message,
                            stack: error.stack
                        })
                    }
                    matchups[`matchups_${key + 1}`] = matchups_prev_week?.data || []
                }))

                if (league.data) {
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
                                    })
                                }
                            }),
                        drafts: drafts.data.map(draft => {
                            return {
                                draft_id: draft.draft_id,
                                status: draft.status,
                                rounds: draft.settings.rounds,
                                draft_order: draft.draft_order
                            }
                        }),
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

    if (season === state.league_season && state.week > 0 && state.week < 19 && state.season_type === 'regular') {
        keys.push(`matchups_${state.week}`)
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
                    const [league, users, rosters] = await Promise.all([
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}/users`),
                        await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}/rosters`)

                    ])
                    let drafts;

                    if (!['in_season', 'complete'].includes(league_to_update.status)) {
                        drafts = await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}/drafts`)
                    }

                    let matchups;

                    if (keys.includes(`matchups_${state.week}`)) {
                        try {
                            matchups = await axios.get(`https://api.sleeper.app/v1/league/${league_to_update}/matchups/${state.week}`)
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
                                    })
                                }
                            }),
                        drafts: drafts?.data?.map(draft => {
                            return {
                                draft_id: draft.draft_id,
                                status: draft.status,
                                rounds: draft.settings.rounds,
                                draft_order: draft.draft_order
                            }
                        }),
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