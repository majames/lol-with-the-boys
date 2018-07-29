import axios from 'axios';
import fs from 'fs';
import flatten from 'lodash.flatten';
import values from 'lodash.values';

const apiKey = fs.readFileSync('./.api-key').toString();

let requestCount = 0;
axios.interceptors.request.use((config) => { 
    console.log('request', requestCount++); 
    return new Promise(resolve => setTimeout(() => resolve(config), Math.random() * 15000));
});

const theBoys = [
    {
        name: 'MJ',
        summonerName: 'TheRoughead',
    },
    {
        name: 'DJ',
        summonerName: 'angjanrg'
    },
    {
        name: 'Big PATTO',
        summonerName: 'aPatto'
    },
    {
        name: 'Seedy Sam',
        summonerName: 'Seedysam23'
    },
    {
        name: 'BIG RIX',
        summonerName: 'RiXY14'
    },
    {
        name: 'The Real DJ',
        summonerName: 'DJ DARC'
    },
    // {
    //     name: 'Loudies',
    //     summonerName: 'DJLoudies2015'
    // },
    {
        name: 'Lach',
        summonerName: 'patto33'
    },
];

interface BoyWithAccountDets {
    id: number;
    accountId: number;
    name: string;
    summonerName: string;
}

interface Match {
    gameId: number;
}

interface BoyWithMatches {
    accountId: number;
    name: string;
    summonerName: string;
    offset: number;
    totalGames: number;
    matches: Match[];
}

interface Participant {
    participantId: number;
    player: {
        accountId: number;
    }
}

const getAccountDets = async (): Promise<BoyWithAccountDets[]> => {
    const summonersEndPoint = 'https://oc1.api.riotgames.com/lol/summoner/v3/summoners/by-name/';

    const requests = theBoys.map(aBoy => {
        return axios.get(
            `${summonersEndPoint}${aBoy.summonerName}`, 
            { headers: { 'X-Riot-Token': apiKey }}
        );
    });

    const responses = await Promise.all(requests);
    return responses.map((resp, i) => ({ ...resp.data, ...theBoys[i] }));
};

const getInitialMatchesForSummoner = async (theBoysWithAccountDets: BoyWithAccountDets[]): Promise<BoyWithMatches[]> => {
    const matchesEndPoint = 'https://oc1.api.riotgames.com/lol/match/v3/matchlists/by-account/';

    const requests = theBoysWithAccountDets.map(aBoy => {
        return axios.get(
            `${matchesEndPoint}${aBoy.accountId}`, 
            { headers: { 'X-Riot-Token': apiKey }}
        );
    });

    const responses = await Promise.all(requests);
    const boysWithInitialMatches = responses
        .map(resp => resp.data)
        .map(({ matches, totalGames, endIndex }, i) => {
            return {
                ...theBoysWithAccountDets[i],
                offset: endIndex,
                totalGames,
                matches: matches.map((match: Match) => ({ gameId: match.gameId })),
            };
        });
    
    return new Promise<BoyWithMatches[]>(resolve => {
        setTimeout(() => resolve(boysWithInitialMatches), 10000);
    });
};

const getSubsequentMatchesForSummoner = async (theBoysWithSomeMatches: BoyWithMatches[]): Promise<BoyWithMatches[]> => {
    const matchesEndPoint = 'https://oc1.api.riotgames.com/lol/match/v3/matchlists/by-account/';

    console.log(theBoysWithSomeMatches.map(boy => ({ offset: boy.offset, totalGames: boy.totalGames})));
    if (theBoysWithSomeMatches.every(boy => boy.offset >= boy.totalGames)) {
        return Promise.resolve(theBoysWithSomeMatches);
    }

    const requests = theBoysWithSomeMatches.map(aBoy => {
        return axios.get(
            `${matchesEndPoint}${aBoy.accountId}?beginIndex=${aBoy.offset}`, 
            { headers: { 'X-Riot-Token': apiKey }}
        );
    });

    const responses = await Promise.all(requests);
    const boysWithAdditionalMatches = responses
        .map(resp => resp.data)
        .map(({ matches, totalGames, endIndex }, i) => {
            return {
                ...theBoysWithSomeMatches[i],
                offset: endIndex,
                totalGames,
                matches: [
                    ...theBoysWithSomeMatches[i].matches,
                    ...matches.map((match: Match) => ({ gameId: match.gameId }))
                ]
            };
        });
    
    return new Promise<BoyWithMatches[]>(resolve => {
        setTimeout(() => resolve(getSubsequentMatchesForSummoner(boysWithAdditionalMatches)), 10000);
    });
};

const flattenIntoRows = (theBoysWithDetsMatches: BoyWithMatches[]) => {
    return flatten(
        theBoysWithDetsMatches.map((aBoy: BoyWithMatches) => {
            return aBoy.matches.map(matchWithDets => ({
                accountId: aBoy.accountId, 
                name: aBoy.name,
                summonerName: aBoy.summonerName, 
                gameId: matchWithDets.gameId,
            }))
        })
    ).map(entry => `${values(entry).join(',')}`);
};

const retrieveMatches = async () => {
    const theBoysWithAccountDets = await getAccountDets();
    const theBoysWithSomeMatches = await getInitialMatchesForSummoner(theBoysWithAccountDets);
    const theBoysWithMatches = await getSubsequentMatchesForSummoner(theBoysWithSomeMatches);

    const rows = flattenIntoRows(theBoysWithMatches);
    fs.writeFileSync('./data.csv', rows.join('\n'));
};

retrieveMatches();
