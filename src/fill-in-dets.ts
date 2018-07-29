import axios from 'axios';
import fs from 'fs';
import values from 'lodash.values';

async function asyncForEach<T>(array: T[], callback: (val: T, index: number, arr: T[]) => Promise<void>) {
    for (let index = 0; index < array.length; index++) {
      await callback(array[index], index, array)
    }
}

const apiKey = fs.readFileSync('./.api-key').toString();

let requestCount = 0;
axios.interceptors.request.use((config) => { 
    console.log(`request: ${requestCount++}`);
    return new Promise(resolve => setTimeout(() => resolve(config), 2000));
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

    console.log(`${matchesEndPoint}${gameId}`);
    const response = await axios.get(
        `${matchesEndPoint}${gameId}`, 
        { headers: { 'X-Riot-Token': apiKey }}
    );

    const { participantIdentities, participants } = response.data;
    // console.log(gameId);
    // console.log(participantIdentities.map((p: any) => p.player.currentAccountId), accountId);

    const participantId = participantIdentities.find(
        (participant: Participant) => participant.player.currentAccountId === accountId
    ).participantId;

    // console.log(participants[participantId]);
    const stats: StatsForGame = participants[participantId - 1].stats;
    return { ...stats, gameId };
};

const getDetailsForMatches = async (accountIdToMatches: Map<number, number[]>): Promise<Map<number, StatsForGame[]>> => {
    const accountIds = Array.from(accountIdToMatches.keys());
    const accountIdToDetsMatches = new Map<number, StatsForGame[]>();

    await asyncForEach(accountIds, async accountId => {
        const matchIds = accountIdToMatches.get(accountId) as number[];

        await asyncForEach(matchIds.slice(0, 2), async gameId => {
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
    const lines = fs.readFileSync('./data.csv').toString().split('\n');

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

    // massage data into CSVEntry
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

    fs.writeFileSync(
        './enriched-data.csv', 
        [
            `${Object.keys(boysWithDetsMatches[0]).join(',')}\n`, // heading row
            boysWithDetsMatches.map(match => `${values(match).join(',')}\n`) // data
        ].join('\n')
    );
};

retrieveDetailsForMatches();
