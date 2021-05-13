'use strict'
const express = require('express')
const currenciesISOSupported = require('./currenciesISOSupported')
require('dotenv').config();
const bodyParser = require('body-parser');
const axios = require('axios');
const loadFactors = require("./loadFactors")
const {parse, stringify} = require('flatted');
// Make a request for a user with a given ID
const plaidCategoriesToNetZeroEmissions = require('./plaidCategoriesToNetZeroEmissions')
const app = express()
const mccEmissionsFactors = require('./mccEmissionsFactors')
const mccToCategory = require('./mcc')
// this will let us get the data from a POST
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const port = process.env.PORT || 5000;
const router = express.Router();

app.use('/api', router);

router.get('/', function(req, res) {
    res.json({ message: 'hooray! welcome to our api!' });   
});

async function currencyConversion(currencyISO1, currencyISO2){
    try{
        let response = await axios({
            method: 'get',
            url: `https://free.currconv.com/api/v7/convert?q=${currencyISO1}_${currencyISO2}&compact=ultra&apiKey=${process.env.currencyconverterapiKey}`,
            json: true
        });
        return response.data[`${currencyISO1}_${currencyISO2}`];
      } catch(err){
          console.error(err);
      }
}

function GCD(lat1, lon1, lat2, lon2) {
    var p = 0.017453292519943295;    // Math.PI / 180
    var c = Math.cos;
    var a = 0.5 - c((lat2 - lat1) * p)/2 + 
            c(lat1 * p) * c(lat2 * p) * 
            (1 - c((lon2 - lon1) * p))/2;
    return 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
  }

  async function getAirportAsync(airportIOTA) {
    try{
      let response = await axios({
          method: 'get',
          url: `https://aviation-edge.com/v2/public/airportDatabase?key=dbb13f-636efe&codeIataAirport=${airportIOTA}`,
          json: true
      });
      return response;
    } catch(err){
        console.error(err);
    }
}

async function getElectricityByUKPostcode(UKpostcode){
     try{
      let response = await axios({
          method: 'get',
          url: `https://api.carbonintensity.org.uk/regional/postcode/${UKpostcode}`,
          json: true
      });
      return parse(stringify(response.data));
    } catch(err){
        console.error(err);
    }
}

router.get('/UKelectricity', async function(req,res ){
    const { postcode } = req.query;
    const emissionsData = await getElectricityByUKPostcode(postcode)
    return res.json({ emissionsData}); 
})



router.get('/transactionTest', async function(req, res) {
    for ( var key in mccToCategory ){
        const mccCategory = mccToCategory[key]
        const emissionsFactor = mccEmissionsFactors[mccCategory]
    }
    
    const mccCategory = mccToCategory[key]
    const emissionsFactor = mccEmissionsFactors[mccCategory]
    const emissionsCO2eKG = (price*emissionsFactor).toFixed(2);
    return res.json({ emissionsCO2eKG }); 
})


router.post('/transactionsMany', async function(req, res) {
    const { transactionsMany } = req.body;
        
    const allEmissions = []
    for (let trans of transactionsMany){
        const emissionsCO2eKG =  await calculateTransactionEmissions(trans)
        let transWithEmissions = trans
        transWithEmissions.emissionsCO2eKG = emissionsCO2eKG
        allEmissions.push(transWithEmissions)
    }
    return res.json({ allEmissions }); 
})


const calculateTransactionEmissions =  async (trans) =>{
    const { price, mcc, currencyISO } = trans;

    // Validate MCC
    const mccInt = +mcc;
    if (isNaN(mccInt) || !mcc in mccToCategory )
        throw new Error("INVALID INPUT - MCC must be a valid string Merchant Category")


    //iso_currency_code    nullable

    if(!currencyISO in currenciesISOSupported)
        throw new Error("INVALID INPUT - Currency must be a valid currency ISO")


    
    let conversionToGBP = 1;
    if (currencyISO != "GBP")
        conversionToGBP = await currencyConversion(currencyISO, "GBP")

    const mccCategory = mccToCategory[mcc]
    
    const emissionsFactor = mccEmissionsFactors[mccCategory]
    const priceInGBP = conversionToGBP*+price
    
    const emissionsCO2eKG = (priceInGBP*emissionsFactor).toFixed(2);
    
    return emissionsCO2eKG
}

router.get('/transaction', async function(req, res) {
    
    
    const emissionsCO2eKG = await calculateTransactionEmissions(req.query)
    return res.json({ emissionsCO2eKG }); 
})


  
router.get('/flight', async function(req, res) {
    const { startAirport, endAirport } = req.query;
    const firstAirport = await getAirportAsync(startAirport)
    const secondAirport = await getAirportAsync(endAirport)

    let {latitudeAirport:latAirport1, longitudeAirport:longAirport1} = firstAirport.data[0]
    let {latitudeAirport:latAirport2, longitudeAirport:longAirport2} = secondAirport.data[0]
   
    let distance = GCD(latAirport1,longAirport1,latAirport2,longAirport2)
    
    // GCD Correction ICAO
    if (distance < 550 && distance > 0) distance +=50
    else if (distance >= 550 && distance < 5500) distance +=100
    else if (distance >=5500) distance +=125
    else console.log("Error in distance: " + distance)


    let averageSeatNumber = 0;
    if (distance < 1500){
        averageSeatNumber = 153.51
    } else if (distance > 2500){
        averageSeatNumber = 280.21
    } else {
        averageSeatNumber = 153.51 + (280.21-153.51)* ((distance-1500)/(2500-1500))
    }
    // ICAO CO2 per pax = 3.16 * (total fuel * pax-to-freight factor)/(number of y-seats * pax load factor)
    const {passengerFactor, loadFactor } = loadFactors["Intra Europe"]

    // console.log(loadFactors["loadFactors:"])
    const effectsIR = 1.9
    const fuelKersosene = 3.16
    const emissionsCO2eKG = effectsIR*fuelKersosene * (distance*passengerFactor).toFixed(1);



    return res.json({ emissionsCO2eKG });   
});

router.post('/car', function(req, res) {
    const { distance, distanceMeasure, vehicle, vehicleModel } = req.body;
    

    let finalVehicle = vehicle;

    const vehicleToModel = {
            //mini
            "citroën c1": 'mini',
            "fiat 500": 'mini',
            "panda": 'mini',
            "peugeot 107":'mini',
            "volkswagen up!":'mini',
            "renault twingo":'mini',
            "toyota aygo":'mini',
            "smart fortwo":'mini',
            "hyundai i 10":'mini',
            // supermini
            "ford fiesta":"supermini",
            "renault clio":"supermini",
            "volkswagen polo":"supermini",
            "citroën c2":"supermini",
            "citroën c3":"supermini",
            "opel corsa":"supermini",
            "peugeot 208":"supermini",
            "toyota yaris":"supermini",
            // lower medium
            "volkswagen golf":"lower medium",
            "ford focus":"lower medium",
            "opel astra":"lower medium",
            "audi a3":"lower medium",
            "bmw 1 series":"lower medium",
            "renault mégane":"lower medium", 
            "toyota auris":"lower medium",
            // upper medium
            "bmw 3 series":"upper medium",
            "škoda octavia":"upper medium",
            "volkswagen passat":"upper medium",
            "audi a4":"upper medium",
            "mercedes benz c class": "uppper medium",
            "peugeot 508":"uppper medium",
            // executive
            "bmw 5 series":"executive",
            "audi a5":"executive",
            "audi a6":"executive",
            "mercedes benz e class": "executive",
            "skoda superb":"executive",
            // luxury
            "jaguar xf":"luxury",
            "mercedes-benz s-class":"luxury",
            "bmw 7 series":"luxury",
            "audi a8":"luxury",
            "porsche panamera":"luxury",
            "lexus ls":"luxury",
            //sport
            "mercedes-benz slk":"sport",
            "audi tt":"sport",
            "porsche 911 and boxster":"sport",
            "peugeot rcz":"sport",
            // dual purpose 4x4
            "suzuki jimny":"dual purpose 4x4",
            "land rover discovery and defender":"dual purpose 4x4",
            "toyota land cruiser":"dual purpose 4x4",
            "nissan pathfinder":"dual purpose 4x4",
            //mpv
            "ford c-max":"mpv",
            "renault scenic":"mpv",
            "volkswagen touran":"mpv",
            "opel zafira":"mpv",
            "ford b-max":"mpv",
            "citroën c3 picasso":"mpv",
            "citroën c4 picasso":"mpv",
        }

    if(vehicleModel.toLowerCase() in vehicleToModel){
        finalVehicle = vehicleToModel[vehicleModel.toLowerCase()]
    }

    // According to UK Dep of Energy
    const emissionsFactorsPerVehicleKM = { 
        'mini':      0.10837 , // this is the smallest category of car sometimes referred to as a city car. examples include: citroën c1, fiat/alfa romeo 500 and panda, peugeot 107, volkswagen up!, renault twingo, toyota aygo, smart fortwo and hyundai i 10.
        'supermini': 0.1308, // this is a car that is larger than a city car, but smaller than a small family car. examples include: ford fiesta, renault clio, volkswagen polo, citroën c2 and c3, opel corsa, peugeot 208, and toyota yaris.
        "lower medium":  0.14197, //this is a small, compact family car. examples include: volkswagen golf, ford focus, opel astra, audi a3, bmw 1 series, renault mégane and toyota auris.
        "upper medium":  0.16098 , //this is classed as a large family car. examples include: bmw 3 series, škoda octavia, volkswagen passat, audi a4, mercedes benz c class and peugeot 508.
        "executive":  0.16735 , // these are large cars. examples include: bmw 5 series, audi a5 and a6, mercedes benz e class and skoda superb.
        "luxury":  0.20198, //this is a luxury car which is niche in the european market. examples include: jaguar xf, mercedes-benz s-class, .bmw 7 series, audi a8, porsche panamera and lexus ls.
        "sport":   0.16996,         //sport cars are a small, usually two seater with two doors and designed for speed, high acceleration, and manoeuvrability. examples include: mercedes-benz slk, audi tt, porsche 911 and boxster, and peugeot rcz. 
        "dual purpose 4x4":   0.19141, // // these are sport utility vehicles (suvs) which have off-road capabilities and four-wheel drive. examples include: suzuki jimny, land rover discovery and defender, toyota land cruiser, and nissan pathfinder.
        "mpv":  0.17627, // these are multipurpose cars. Examples include: Ford C-Max, Renault Scenic, Volkswagen Touran, Opel Zafira, Ford B-Max, and Citroën C3 Picasso and C4 Picasso. 

    }

    const emissionsFactorsPerVehicleMiles = {
        'mini':  0.17442,
        'supermini': 0.21051,
        "lower medium": 0.22849,
        "upper medium": 0.25907 ,
        "executive":  0.26934 ,
        "luxury":  0.32506,
        "sport":  0.27353,
        "dual purpose 4x4":  0.30805 ,
        "mpv":  0.28369 ,
    }

    const emissionFactorVehicle = distanceMeasure.toLowerCase()=="km" ? emissionsFactorsPerVehicleKM[finalVehicle.toLowerCase()] : emissionsFactorsPerVehicleMiles[finalVehicle.toLowerCase()]
    const emissionsCO2KGe= distance * emissionFactorVehicle

    return res.json({ emissionsCO2KGe });   
});

app.listen(port);
console.log('Magic happens on port ' + port);
module.exports = app