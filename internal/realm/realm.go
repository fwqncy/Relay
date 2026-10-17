// Package realm defines Relay's logistics progression: each transport mode
// levels up from deliveries, and each level unlocks a new class of vehicle
// that the 3D map renders.
package realm

import (
	"fmt"
	"math"
	"time"
)

var Modes = []string{"sea", "road", "rail", "air"}

// Thresholds is the XP (one per delivery) needed to reach each level.
var Thresholds = []int{0, 50, 150, 400, 1000}

const MaxLevel = 5

func ValidMode(m string) bool {
	for _, x := range Modes {
		if x == m {
			return true
		}
	}
	return false
}

// Level returns the level for an XP total.
func Level(xp int) int {
	lvl := 1
	for i, t := range Thresholds {
		if xp >= t {
			lvl = i + 1
		}
	}
	return lvl
}

// NextAt is the XP needed for the next level, or 0 at the cap.
func NextAt(level int) int {
	if level >= MaxLevel {
		return 0
	}
	return Thresholds[level]
}

type Tier struct {
	Level       int    `json:"level"`
	Vehicle     string `json:"vehicle"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

var Tiers = map[string][]Tier{
	"sea": {
		{1, "Sailboat", "Fishing quay", "Single-mast sailboats ferry crates along the coast."},
		{2, "Galleon", "Merchant harbour", "Three-masted galleons carry bulk goods between ports."},
		{3, "Steamship", "Age of steam", "Coal-fired steamers keep schedules whatever the wind."},
		{4, "Coastal freighter", "Feeder port", "Feeder freighters shuttle stacked containers between hubs."},
		{5, "Container ship", "Deep-water terminal", "Ultra-large container ships berth at your docks."},
	},
	"road": {
		{1, "Horse cart", "Cart track", "Horse-drawn carts haul sacks along packed-earth roads."},
		{2, "Delivery van", "Cobbled roads", "Vans run the last mile through town."},
		{3, "Box truck", "Paved routes", "Box trucks carry pallets between depots."},
		{4, "Semi truck", "Highway freight", "Tractor-trailers move full loads overnight."},
		{5, "Road train", "Freight corridor", "Double-trailer road trains run the trunk routes."},
	},
	"rail": {
		{1, "Steam engine", "Iron road", "A small steam engine pulls a pair of timber wagons."},
		{2, "Steam freight", "Goods line", "Longer steam freights serve the market towns."},
		{3, "Diesel freight", "Diesel age", "Diesel locomotives haul strings of boxcars."},
		{4, "Intermodal freight", "Intermodal yard", "Container flats link the port to inland hubs."},
		{5, "Maglev freight", "Maglev line", "Magnetic-levitation freight glides between terminals."},
	},
	"air": {
		{1, "Hot-air balloon", "Balloon post", "Balloons drift urgent letters over the hills."},
		{2, "Biplane", "Airmail strip", "Open-cockpit biplanes fly the mail routes."},
		{3, "Prop freighter", "Regional airfield", "Twin-prop freighters serve regional airports."},
		{4, "Cargo jet", "Air freight hub", "Narrow-body cargo jets run overnight sorts."},
		{5, "Heavy-lift jet", "Global gateway", "Four-engine heavy-lift jets cross oceans in a night."},
	},
}

// Milestone is an unlockable achievement.
type Milestone struct {
	Key         string `json:"key"`
	Mode        string `json:"mode,omitempty"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

// LevelMilestone is unlocked when a mode reaches a level.
func LevelMilestone(mode string, level int) Milestone {
	t := Tiers[mode][level-1]
	return Milestone{
		Key: fmt.Sprintf("%s-%d", mode, level), Mode: mode, Title: t.Title,
		Description: fmt.Sprintf("Reach %s level %d: %s", ModeName(mode), level, t.Description),
	}
}

// DeliveryMilestones unlock on lifetime deliveries across all modes.
var DeliveryMilestones = []struct {
	At int
	Milestone
}{
	{100, Milestone{Key: "deliveries-100", Title: "Hundredfold", Description: "Complete 100 deliveries."}},
	{500, Milestone{Key: "deliveries-500", Title: "Guild charter", Description: "Complete 500 deliveries."}},
	{1000, Milestone{Key: "deliveries-1000", Title: "Trade league", Description: "Complete 1,000 deliveries."}},
	{2500, Milestone{Key: "deliveries-2500", Title: "Realm of commerce", Description: "Complete 2,500 deliveries."}},
}

// AllMilestones lists every milestone in display order.
func AllMilestones() []Milestone {
	var out []Milestone
	for _, d := range DeliveryMilestones {
		out = append(out, d.Milestone)
	}
	for _, m := range Modes {
		for lvl := 2; lvl <= MaxLevel; lvl++ {
			out = append(out, LevelMilestone(m, lvl))
		}
	}
	return out
}

func ModeName(mode string) string {
	switch mode {
	case "sea":
		return "Sea"
	case "road":
		return "Road"
	case "rail":
		return "Rail"
	case "air":
		return "Air"
	}
	return mode
}

// weights shape each company's traffic: a port operator runs more ships,
// a parcel network more vans and planes.
var weights = map[string]map[string]float64{
	"harborline": {"sea": 1.2, "road": 1.0, "rail": 0.7, "air": 0.5},
	"meridian":   {"sea": 0.9, "road": 1.2, "rail": 0.9, "air": 0.6},
	"kestrel":    {"sea": 0.35, "road": 1.3, "rail": 0.6, "air": 1.1},
}

// TargetActive is how many shipments a mode keeps moving. It grows with
// level, so a busier network shows more vehicles on the map.
func TargetActive(company, mode string, level int) int {
	w := 1.0
	if cw, ok := weights[company]; ok {
		w = cw[mode]
	}
	return max(1, int(math.Round(float64(2+2*level)*w)))
}

// TransitRange is the simulated door-to-door time for a mode.
func TransitRange(mode string) (time.Duration, time.Duration) {
	switch mode {
	case "sea":
		return 36 * time.Hour, 96 * time.Hour
	case "rail":
		return 10 * time.Hour, 30 * time.Hour
	case "air":
		return 4 * time.Hour, 14 * time.Hour
	default:
		return 3 * time.Hour, 10 * time.Hour
	}
}

var Carriers = map[string][]string{
	"sea":  {"Saltmere Lines", "Greywater Shipping", "Northreach Maritime", "Brinewood Freight"},
	"road": {"Blue Ridge Haulage", "Coastline Carriers", "Summit Transport", "Delta Line Trucking", "Ironbridge Logistics", "Prairie Express"},
	"rail": {"Ironvale Rail", "Kingsway Freight Rail", "Ashford Railways"},
	"air":  {"Skyhold Air Cargo", "Falconcrest Air", "Aerie Express"},
}

// Places lists plausible origins and destinations per company and mode.
// The company's own hub is always one end of a lane.
var Places = map[string]map[string][]string{
	"harborline": {
		"hub":  {"Savannah, GA"},
		"sea":  {"Rotterdam, NL", "Santos, BR", "Shanghai, CN", "Antwerp, BE", "Cartagena, CO"},
		"road": {"Atlanta, GA", "Charleston, SC", "Jacksonville, FL", "Macon, GA", "Columbia, SC"},
		"rail": {"Memphis, TN", "Chicago, IL", "Charlotte, NC", "Birmingham, AL"},
		"air":  {"Miami, FL", "Dallas, TX", "Newark, NJ", "Louisville, KY"},
	},
	"meridian": {
		"hub":  {"Rotterdam, NL"},
		"sea":  {"Valencia, ES", "Felixstowe, UK", "Gdańsk, PL", "Algeciras, ES", "Gothenburg, SE"},
		"road": {"Antwerp, BE", "Düsseldorf, DE", "Venlo, NL", "Lille, FR", "Utrecht, NL"},
		"rail": {"Duisburg, DE", "Milan, IT", "Lyon, FR", "Prague, CZ"},
		"air":  {"Liège, BE", "Frankfurt, DE", "Nairobi, KE", "Madrid, ES"},
	},
	"kestrel": {
		"hub":  {"Leeds, UK"},
		"sea":  {"Hull, UK", "Belfast, UK", "Dublin, IE", "Zeebrugge, BE"},
		"road": {"Manchester, UK", "York, UK", "Sheffield, UK", "Newcastle, UK", "Birmingham, UK"},
		"rail": {"Glasgow, UK", "London, UK", "Daventry, UK", "Doncaster, UK"},
		"air":  {"East Midlands, UK", "Edinburgh, UK", "Cologne, DE", "Belfast, UK"},
	},
}

var Customers = []string{
	"Greenleaf Grocers", "Atlas Hardware", "Bramble & Co", "Northside Pharmacy", "Copperline Electronics",
	"Hollow Oak Furniture", "Fernhill Outfitters", "Stonebridge Mills", "Lantern Row Books", "Mossgate Apothecary",
	"Ravenscroft Textiles", "Thistledown Dairy",
}
