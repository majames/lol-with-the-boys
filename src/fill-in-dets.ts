import axios from 'axios';
import fs from 'fs';

const keysOfInterest = 'accountId,name,summonerName,participantId,win,item0,item1,item2,item3,item4,item5,item6,kills,deaths,assists,largestKillingSpree,largestMultiKill,killingSprees,longestTimeSpentLiving,doubleKills,tripleKills,quadraKills,pentaKills,unrealKills,totalDamageDealt,magicDamageDealt,physicalDamageDealt,trueDamageDealt,largestCriticalStrike,totalDamageDealtToChampions,magicDamageDealtToChampions,physicalDamageDealtToChampions,trueDamageDealtToChampions,totalHeal,totalUnitsHealed,damageSelfMitigated,damageDealtToObjectives,damageDealtToTurrets,visionScore,timeCCingOthers,totalDamageTaken,magicalDamageTaken,physicalDamageTaken,trueDamageTaken,goldEarned,goldSpent,turretKills,inhibitorKills,totalMinionsKilled,neutralMinionsKilled,neutralMinionsKilledTeamJungle,neutralMinionsKilledEnemyJungle,totalTimeCrowdControlDealt,champLevel,visionWardsBoughtInGame,sightWardsBoughtInGame,wardsPlaced,wardsKilled,firstBloodKill,firstBloodAssist,firstTowerKill,firstTowerAssist,firstInhibitorKill,firstInhibitorAssist,combatPlayerScore,objectivePlayerScore,totalPlayerScore,totalScoreRank,playerScore0,playerScore1,playerScore2,playerScore3,playerScore4,playerScore5,playerScore6,playerScore7,playerScore8,playerScore9,perk0,perk0Var1,perk0Var2,perk0Var3,perk1,perk1Var1,perk1Var2,perk1Var3,perk2,perk2Var1,perk2Var2,perk2Var3,perk3,perk3Var1,perk3Var2,perk3Var3,perk4,perk4Var1,perk4Var2,perk4Var3,perk5,perk5Var1,perk5Var2,perk5Var3,perkPrimaryStyle,perkSubStyle,gameId'.split(',') as (keyof CSVEntry)[];

async function asyncForEach<T>(array: T[], callback: (val: T, index: number, arr: T[]) => Promise<void>) {
    for (let index = 0; index < array.length; index++) {
      await callback(array[index], index, array)
    }
}

const apiKey = fs.readFileSync('./.api-key').toString();

let requestCount = 0;
axios.interceptors.request.use((config) => { 
    console.log(`request: ${requestCount++}`);
    return new Promise(resolve => setTimeout(() => resolve(config), 1400));
});

interface Participant {
    participantId: number;
    player: {
        accountId: number;
        currentAccountId: number;
    }
}

interface StatsForGame {
    gameId: number;
    win: boolean;
    kills: number;
    deaths: number;
    assists: number;
}

interface CSVEntry extends StatsForGame {
    accountId: number;
    name: string;
    summonerName: string;
}

const getDetailsForMatch = async (accountId: number, gameId: number): Promise<StatsForGame> => {
    const matchesEndPoint = 'https://oc1.api.riotgames.com/lol/match/v3/matches/';

    const response = await axios.get(
        `${matchesEndPoint}${gameId}`, 
        { headers: { 'X-Riot-Token': apiKey }}
    );

    const { participantIdentities, participants } = response.data;

    const participantId = participantIdentities.find(
        (participant: Participant) => participant.player.currentAccountId === accountId
    ).participantId;

    const stats: StatsForGame = participants[participantId - 1].stats;
    return { ...stats, gameId };
};

const getDetailsForMatches = async (accountIdToMatches: Map<number, number[]>): Promise<Map<number, StatsForGame[]>> => {
    const accountIds = Array.from(accountIdToMatches.keys());
    const accountIdToDetsMatches = new Map<number, StatsForGame[]>();

    await asyncForEach(accountIds, async accountId => {
        const matchIds = accountIdToMatches.get(accountId) as number[];

        await asyncForEach(matchIds, async gameId => {
            const matchWithDets = await getDetailsForMatch(accountId, gameId);

            if (accountIdToDetsMatches.has(accountId) === false) {
                accountIdToDetsMatches.set(accountId, []);
            }
            
            const arr = accountIdToDetsMatches.get(accountId) as StatsForGame[];
            arr.push(matchWithDets);
        });
    });

    return accountIdToDetsMatches;
};

const retrieveDetailsForMatches = async () => {
    const lines = fs.readFileSync('./data-1000.csv').toString().split('\n');

    const accountIdToMatches = new Map<number, number[]>();
    const accountIdToNames = new Map<number, {name: string, summonerName: string}>();

    // fill in maps
    lines.forEach(line => {
        const { 0: accountIdStr, 1: name, 2: summonerName, 3: matchIdStr } = line.split(',');

        const accountId = Number.parseInt(accountIdStr);
        const matchId = Number.parseInt(matchIdStr);

        if (accountIdToMatches.has(accountId) === false && accountIdToNames.has(accountId) === false) {
            accountIdToMatches.set(accountId, []);
            accountIdToNames.set(accountId, {name, summonerName});
        }

        (accountIdToMatches.get(accountId) as number[]).push(matchId);
    });

    // get details for matches
    const accountIdToMatchesDets = await getDetailsForMatches(accountIdToMatches);

    // massage data into CSVEntry JSON object
    const boysWithDetsMatches: CSVEntry[] = [];
    Array.from(accountIdToMatchesDets.keys()).forEach(accountId => {
        const { name, summonerName } = accountIdToNames.get(accountId) as {name: string; summonerName: string};
        const matchesWithDets = accountIdToMatchesDets.get(accountId) as StatsForGame[];

        matchesWithDets.forEach(matchWithDets => {
            boysWithDetsMatches.push({
                accountId,
                name,
                summonerName,
                ...matchWithDets
            });
        });
    });

    // group values into columns, undefined is added to a col with the value is missing
    const groupCols = keysOfInterest.reduce((m, colTitle) => {
        m.set(colTitle as keyof CSVEntry, []);
        return m;
    }, new Map<keyof CSVEntry, any>());

    boysWithDetsMatches.forEach(match => {
        keysOfInterest.forEach(title => {
            groupCols.get(title).push(match[title]);
        });
    });

    // convert into string rows
    const numRows = groupCols.values().next().value.length;
    const rows = [];
    for (let i = 0; i < numRows; i++) {
        const row = keysOfInterest.map(title => groupCols.get(title)[i]);
        rows.push(row.join(','));
    }

    fs.writeFileSync(
        './enriched-data-final.csv', 
        [
            Object.keys(boysWithDetsMatches[0]).join(','), // heading row
            rows.join('\n')
        ].join('\n')
    );
};

retrieveDetailsForMatches();
