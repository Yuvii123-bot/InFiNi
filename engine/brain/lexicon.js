// INFINI AI — brain: word lists used to read informal chat text.
// Everything here is plain data written for this project (no external source).

const W = (s) => new Set(s.trim().split(/\s+/));
const M = (s) => new Map(s.trim().split(/\s*;\s*/).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i).trim(), p.slice(i + 1).trim()]; }));

/** Chat-speak and frequent misspellings → standard words (applied token by token). */
export const CHAT = M(`
u=you; ur=your; urs=yours; urself=yourself; yu=you; yuo=you; yoy=you; r=are; k=ok; kk=ok; okk=ok; okey=ok; okie=ok; oki=ok; okay=ok; okayy=ok; oke=ok; okz=ok;
alr=alright; aight=alright; ight=alright; allright=alright; pls=please; plz=please; plzz=please; pleas=please; plss=please;
thx=thanks; thnx=thanks; thanx=thanks; tnx=thanks; thnks=thanks; thks=thanks; tks=thanks; thanku=thank you; thankyou=thank you; ty=thank you; tysm=thank you so much; tyvm=thank you very much; thnk=thank; thanq=thank you;
wat=what; wht=what; wot=what; whts=what is; whats=what is; wats=what is; hw=how; hows=how is; hru=how are you; wbu=what about you; hbu=how about you; wyd=what are you doing; wru=where are you;
wassup=what is up; wazzup=what is up; whatsup=what is up; whassup=what is up; sup=what is up; wsp=what is up; wsup=what is up;
abt=about; bout=about; bcz=because; bcoz=because; bcuz=because; cuz=because; coz=because; cos=because; becoz=because; bc=because;
gud=good; gd=good; gr8=great; grt=great; luv=love; lov=love; nd=and;
yea=yes; yeah=yes; yeh=yes; yep=yes; yup=yes; yess=yes; yas=yes; ye=yes; yh=yes; yah=yes; yupp=yes; yeap=yes; nah=no; nope=no; naw=no; noo=no; nop=no;
idk=i do not know; idc=i do not care; ik=i know; ikr=i know right; imo=in my opinion; btw=by the way; omg=oh my god; lmao=lol; lmfao=lol; rofl=lol; lolz=lol; lel=lol; kek=lol;
brb=be right back; gtg=got to go; g2g=got to go; ttyl=talk to you later; cya=see you; cu=see you; np=no problem; nvm=never mind; nvmd=never mind; nth=nothing; tbh=to be honest; rn=right now; atm=at the moment;
2day=today; tday=today; 2moro=tomorrow; tmrw=tomorrow; tmr=tomorrow; tomo=tomorrow; 2nite=tonight; tonite=tonight; b4=before;
im=i am; iam=i am; ima=i am going to; ive=i have; dont=do not; doesnt=does not; didnt=did not; cant=can not; cannot=can not; wont=will not; wouldnt=would not; shouldnt=should not; couldnt=could not;
isnt=is not; arent=are not; wasnt=was not; werent=were not; havent=have not; hasnt=has not; hadnt=had not; aint=is not; youre=you are; ure=you are; youve=you have; youll=you will; youd=you would;
thats=that is; theres=there is; heres=here is; hes=he is; shes=she is; theyre=they are; weve=we have; lets=let us; wheres=where is; whos=who is; whens=when is; whys=why is;
wanna=want to; gonna=going to; gotta=got to; gimme=give me; lemme=let me; kinda=kind of; sorta=sort of; dunno=do not know; outta=out of; lotta=lot of; cmon=come on; yall=you all;
ppl=people; msg=message; bday=birthday; bf=boyfriend; gf=girlfriend; bff=best friend; frnd=friend; frnds=friends; fren=friend; frend=friend;
da=the; dat=that; dis=this; dem=them; dey=they; wen=when; wer=where; wher=where; whr=where; hav=have; hv=have; giv=give; gv=give; tel=tell; knw=know; kno=know; nw=now; nt=not; bt=but; jst=just; jus=just;
rly=really; rlly=really; srsly=seriously; def=definitely; prob=probably; probs=probably; sry=sorry; sorri=sorry; soz=sorry; srry=sorry;
mornin=morning; morn=morning; gm=good morning; gn=good night; gnight=good night; nite=night; nyt=night; goodnight=good night; gudnight=good night; goodmorning=good morning; gudmorning=good morning; goodevening=good evening; goodafternoon=good afternoon;
tc=take care; hbd=happy birthday; congrats=congratulations; congratz=congratulations; fav=favorite; fave=favorite; favourite=favorite; favourites=favorites; colour=color; colours=colors; humour=humor;
realise=realize; apologise=apologize; mum=mom; mummy=mommy; info=information; pic=picture; pics=pictures;
heya=hey; hiya=hi; hii=hi; hy=hi; hie=hi; helo=hello; hellow=hello; hallo=hello; hullo=hello; hlo=hello; hllo=hello; hlw=hello; heyy=hey; ello=hello;
namaskar=namaste; namaskaar=namaste; nmste=namaste; namastey=namaste;
corect=correct; currect=correct; corret=correct; correctly=correctly; wrng=wrong; rong=wrong; rite=right; ryt=right; rght=right;
concience=conscience; consious=conscious; concious=conscious; inteligent=intelligent; inteligence=intelligence; intellegent=intelligent; frist=first; freind=friend; beleive=believe; recieve=receive; tommorow=tomorrow; tomorow=tomorrow;
fialogue=dialogue; excahnge=exchange; egts=gets; si=is; conputer=computer; wich=which; whic=which; becuase=because; becasue=because; realy=really; alot=a lot; cud=could; wud=would; shud=should; ne1=anyone; sum1=someone; every1=everyone; no1=no one;
goverment=government; govenment=government; govermnent=government; enviroment=environment; enviornment=environment; definately=definitely; definitly=definitely; seperate=separate; seperately=separately;
occured=occurred; occurence=occurrence; occuring=occurring; untill=until; begining=beginning; beleif=belief; calender=calendar; cemetary=cemetery; embarass=embarrass; existance=existence; foriegn=foreign; fourty=forty;
grammer=grammar; harrass=harass; immediatly=immediately; independant=independent; knowlege=knowledge; knowlegde=knowledge; libary=library; lisence=license; maintainance=maintenance; millenium=millennium;
neccessary=necessary; necesary=necessary; noticable=noticeable; occassion=occasion; persistant=persistent; posession=possession; prefered=preferred; publically=publicly; recomend=recommend; reccomend=recommend; refered=referred;
relevent=relevant; religous=religious; remeber=remember; resistence=resistance; succesful=successful; successfull=successful; suprise=surprise; tendancy=tendency; threshhold=threshold; tounge=tongue; truely=truly;
unfortunatly=unfortunately; writting=writing; accomodate=accommodate; acheive=achieve; accross=across; agressive=aggressive; apparantly=apparently; appearence=appearance; arguement=argument; basicly=basically;
bizzare=bizarre; buisness=business; bussiness=business; catagory=category; collegue=colleague; comming=coming; commitee=committee; completly=completely; curiousity=curiosity; dissapear=disappear; dissapoint=disappoint;
familar=familiar; finaly=finally; foward=forward; futher=further; happend=happened; humourous=humorous; incidently=incidentally; interupt=interrupt; mispell=misspell; occurance=occurrence; politican=politician;
portugese=portuguese; propoganda=propaganda; questionaire=questionnaire; rythm=rhythm; secratary=secretary; strenght=strength; tommorrow=tomorrow; vaccum=vacuum; vegatarian=vegetarian; wellfare=welfare;
refridgerator=refrigerator; volcanoe=volcano; discoverd=discovered; inventd=invented; diffrent=different; diffrence=difference; intresting=interesting; importent=important; langauge=language; lanuage=language;
proffesional=professional; profesional=professional; sucess=success; technolgy=technology; tecnology=technology; univeristy=university; univercity=university; scince=science; sceince=science; mathmatics=mathematics;
temprature=temperature; tempreture=temperature; goverments=governments; populaton=population; pronounciation=pronunciation; restarant=restaurant; resturant=restaurant; adress=address; alchohol=alcohol; begginer=beginner;
beautifull=beautiful; beutiful=beautiful; calculater=calculator; charactor=character; choclate=chocolate; countrys=countries; dictionery=dictionary; excercise=exercise; exersise=exercise; febuary=february;
freqently=frequently; gaurantee=guarantee; garantee=guarantee; hieght=height; hygeine=hygiene; inteligence=intelligence; medecine=medicine; nessesary=necessary; orignal=original; parliment=parliament; perfomance=performance;
presidnet=president; priviledge=privilege; probaly=probably; reciept=receipt; rember=remember; sentance=sentence; similiar=similar; sincerly=sincerely; speach=speech; statment=statement; studing=studying; thier=their;
tomatos=tomatoes; potatos=potatoes; vehical=vehicle; wensday=wednesday; yeild=yield; histroy=history; theroy=theory; thoery=theory; isreal=israel; fransisco=francisco; mountian=mountain; machne=machine; telephne=telephone; artifical=artificial; inteligent=intelligent
`);

/** Words that add no meaning for matching ("please tell me a joke" = "tell me a joke"). */
export const FILLER = W('please kindly just really very actually basically literally honestly well um uh er erm oh ah like so then though tho anyway anyways also too btw simply quite totally absolutely definitely certainly probably exactly indeed truly surely kinda sorta pretty rather much damn dang darn heck gosh geez jeez');
/** Vocatives: dropped at the start of a message, or at its end when they do not complete a phrase. */
export const ADDRESS = W('infini infiniai ai bot robot buddy bud bro bruh bruv brother sis dude man mate pal friend dear sir madam mam maam boss chief yaar yar ji dai bhai didi bahini sathi guys folks everyone everybody all there assistant computer machine chatbot');
/** Words that can open a message and be answered separately from what follows ("ok thanks, what is X"). */
export const INTERJ = W('hi hello hey yo hola namaste greetings ok alright well so oh ah hmm hm yes no sure wow lol cool nice great thanks sorry and but please right fine good awesome perfect');

export const WH = W('what who whom whose where when why how which');
export const AUX = W('is are am was were do does did can could will would should shall may might have has had must');
export const P1 = W('i me my mine myself we us our ours ourselves');
export const P2 = W('you your yours yourself');
/** Function words: never count as "content" when checking whether a message is about a topic. */
export const STOP = W(`a an the this that these those it its is are am was were be been being do does did done doing have has had having will would shall should can could may might must
 i me my mine myself we us our you your yours yourself he him his she her they them their and or but if because as of at by for with about to from in on off out up down over under again
 not no yes what who whom whose where when why how which there here any some all each every one ones than then also only own same such more most other`);

/** Verbs that describe the assistant itself in "how do you …" questions. Anything else after "how do you" is the generic "you" ("how do you make tea"). */
export const SELF_VERBS = W(`work function operate exist feel think know learn understand remember mean look sound sleep live like love hate want prefer believe hear answer respond reply search
 decide choose rank verify dream breathe age die grow talk speak chat help rest relax cope manage reason compute process store save forget lie joke laugh cry smile cite trust judge`);

/** Other assistants and fictional machines, for "hello Alexa" style greetings. */
export const OTHER_BOTS = W('alexa siri cortana bixby google gemini bard chatgpt gpt claude copilot grok jarvis hal r2d2 r2 c3po wall e walle skynet samantha watson eliza llama meta deepseek perplexity');

/** Emoji → the word they usually stand for. */
export const EMOJI = new Map(Object.entries({
  laugh: '😂🤣😆😹😅😄😁', smile: '🙂😊😀😃☺😇🤗😌😺😸', love: '❤😍🥰😘💕💖💗💓💞💘💝💙💚💛💜🧡🤍🖤😻♥', sad: '😢😭😞😔☹🙁💔😿😥😪🥺😩😫', angry: '😠😡🤬👿😤',
  up: '👍👌🙌👏💪✅🤝🆗👊🤙', down: '👎', pray: '🙏', wave: '👋🤚✋', think: '🤔🧐', wow: '😮😲😱🤯😯😳', party: '🎉🥳🎊🎂🎈', sleepy: '😴🥱💤', sick: '🤒🤢🤮🤧😷🤕', cool: '😎🔥💯⭐🌟✨', wink: '😉😜😛😝🤪😋', shrug: '🤷', eyes: '👀',
}).flatMap(([cls, chars]) => [...chars].map((ch) => [ch, cls])));
export const EMOTICONS = [[/(^|\s)(?::-?\)+|=\)|\(:|:-?\]|\^[_-]?\^)(?=\s|$)/g, 'smile'], [/(^|\s)(?::-?d+|x-?d+|=d)(?=\s|$)/gi, 'laugh'], [/(^|\s)(?::-?\(+|:'-?\(|=\(|d:)(?=\s|$)/gi, 'sad'], [/(^|\s)<3+(?=\s|$)/g, 'love'], [/(^|\s);-?\)(?=\s|$)/g, 'wink'], [/(^|\s):-?[po](?=\s|$)/gi, 'wink'], [/(^|\s)(?::-?[/\\|]|-_+-)(?=\s|$)/g, 'think']];
export const EMOJI_WORD = { laugh: 'lol', smile: 'nice', love: 'love it', sad: 'sad', angry: 'angry', up: 'ok', down: 'not good', pray: 'thanks', wave: 'hi', think: 'hmm', wow: 'wow', party: 'yay', sleepy: 'sleepy', sick: 'sick', cool: 'cool', wink: 'lol', shrug: 'i do not know', eyes: 'hmm' };

/** Feelings a person may report about themselves. Key = feeling class, value = words and short phrases. */
const F = (s) => s.trim().split(/\s*,\s*/);
export const FEEL = {
  sad: F('sad, unhappy, down, depressed, upset, miserable, heartbroken, heart broken, gloomy, blue, low, hurt, crying, devastated, hopeless, awful, terrible, horrible, bad, crushed, disappointed, grieving, empty, numb, worthless, broken, down in the dumps, sorrowful, tearful, dejected, glum, melancholy, in pain, hurting, shattered, defeated, useless, a failure, rubbish, crap, shitty, lousy, rough, unwell emotionally, not myself'),
  happy: F('happy, good, great, fine, well, awesome, amazing, fantastic, wonderful, excellent, glad, joyful, cheerful, delighted, overjoyed, content, pleased, blessed, grateful, thankful, positive, super, perfect, alright, cool, better, much better, doing well, doing good, doing great, doing fine, all good, all right, pretty good, very well, not bad, not too bad, ok, on top of the world, over the moon, marvelous, splendid, terrific, fabulous, lovely, relaxed, calm, peaceful, chill, at peace, optimistic, hopeful, in a good mood, feeling good'),
  excited: F('excited, pumped, hyped, stoked, thrilled, psyched, ecstatic, elated, buzzing, eager, enthusiastic, fired up, motivated, inspired'),
  angry: F('angry, mad, furious, annoyed, irritated, pissed, pissed off, frustrated, outraged, livid, fuming, cross, enraged, ticked off, fed up, irate, grumpy, cranky, agitated, bitter, resentful, in a bad mood'),
  anxious: F('anxious, nervous, worried, scared, afraid, stressed, stressed out, tense, panicking, panicked, terrified, frightened, uneasy, overwhelmed, freaking out, under pressure, restless, on edge, fearful, insecure, concerned, burdened, pressured, shy'),
  tired: F('tired, exhausted, sleepy, drained, worn out, fatigued, beat, wiped, wiped out, burnt out, burned out, drowsy, knackered, weary, dead tired, so tired, lazy, sluggish, spent, pooped'),
  bored: F('bored, bored to death, bored out of my mind, so bored, getting bored'),
  lonely: F('lonely, alone, isolated, abandoned, left out, friendless, homesick, all alone, lonesome, unloved, unwanted, ignored, forgotten, rejected, invisible'),
  sick: F('sick, ill, unwell, feverish, nauseous, dizzy, injured, under the weather, not feeling well, poorly, coughing, in bed with a cold, down with a fever'),
  hungry: F('hungry, starving, famished, peckish, starved, so hungry'),
  thirsty: F('thirsty, parched'),
  confused: F('confused, puzzled, unsure, stuck, clueless, baffled, perplexed, lost, uncertain, bewildered, torn, undecided, indecisive'),
  proud: F('proud, accomplished, confident, strong, brave, unstoppable'),
  embarrassed: F('embarrassed, ashamed, guilty, humiliated, awkward, sorry for myself, stupid, dumb, an idiot, foolish, silly'),
  inlove: F('in love, falling in love, smitten, crushing'),
  busy: F('busy, swamped, occupied, snowed under, tied up, working, studying'),
  soso: F('so so, meh, okayish, average, could be better, surviving, hanging in there, getting by, same old, nothing special, neither good nor bad, fine i guess, ok i guess, alive, existing, managing, not great, not so good, not too good, not that good, not very well, not so well, not too well'),
  cold: F('cold, freezing, chilly, shivering'), hot: F('hot, sweating, boiling, melting, roasting'),
  surprised: F('surprised, shocked, amazed, astonished, stunned, speechless'),
  curious: F('curious, interested, intrigued, wondering'),
  free: F('free, available, not busy, idle, doing nothing'),
};
/** "not X" flips: which feeling "not <word>" expresses. */
export const NOT_FEEL = { happy: 'sad', sad: 'happy', angry: 'happy', anxious: 'happy', tired: 'happy', sick: 'happy', hungry: 'happy', bored: 'happy', lonely: 'happy', busy: 'free', confused: 'happy' };
export const INTENS = W('very so really extremely super quite pretty too totally absolutely incredibly terribly awfully seriously kind of sort a bit little feeling just still always often sometimes somewhat rather damn bloody freaking fucking fairly particularly especially genuinely truly honestly');

/** First-person messages that need a careful, non-playful reply. Checked before anything else. */
export const CRISIS = [
  /\b(kill|hurt|harm|cut|hang|shoot|drown|poison|stab|burn) (myself|my self|meself)\b/,
  /\b(suicide|suicidal)\b.*\b(i|me|my|myself)\b|\b(i|me|my|myself)\b.*\b(suicide|suicidal)\b/,
  /\b(end|ending|take|taking) (my|my own) life\b|\bend it all\b|\bend(ing)? everything\b.*\bi\b|\bi\b.*\bend(ing)? everything\b/,
  /\bi (really |just |honestly |so |sometimes |do |)(want|wanna|wish|need|would like|am going|am planning|plan|have decided|am ready|feel like|think about|keep thinking about)( to| i could| i was| of| about)? ?(die|dying|be dead|was dead|were dead|disappear forever|not exist|stop existing|not be alive|not wake up|never wake up|sleep forever|kill)\b/,
  /\b(do not|dont|not) (want|wanna|wish) to (live|be alive|exist|be here|wake up|go on|continue living)\b|\bno (reason|point) (to|in) (live|living|go on|going on)\b|\b(better off|rather be) dead\b|\b(not worth living|tired of living|done with life|hate my life|life is pointless|life is meaningless|can not go on|cant go on)\b/,
  /\bi (want|need|am going|plan|am planning) to (overdose|jump off|jump from|slit)\b|\bself[- ]?harm(ing)?\b.*\b(i|me|my|myself)\b|\bi\b.*\bself[- ]?harm/,
  /\b(nobody|no one) would (care|miss me|notice) if i (died|was gone|were gone|disappeared)\b|\beveryone would be better (off )?without me\b|\bi (should|might as well) (just )?(die|disappear|be dead)\b/,
];
export const CRISIS_NOT = /\b(dying|die|died|dead|kill|kills|killing|killed)\b.{0,12}\b(of|from|with|me with)? ?(laugh|laughter|laughing|boredom|curiosity|hunger|thirst|heat|embarrassment|cute|cuteness|joke|funny|hilarious|lol)\b|\b(game|movie|film|book|song|novel|series|show|character|level|boss|minecraft|fortnite|pubg|free fire)\b/;

/** Insults and crude language aimed at the assistant (answered calmly, never mirrored). */
export const RUDE = W('stupid idiot dumb dumbass moron fool useless worthless trash garbage rubbish crap shit bullshit shitty sucks suck stfu bastard bitch asshole ass jerk loser pathetic lame retard retarded ugly fat fuck fucking fucker fck fuk wtf dick damn hate annoying liar fake noob nonsense clown donkey pig');
export const SEXUAL = /\b(sex|sexy|sext|nude|nudes|naked|porn|boobs?|tits|penis|vagina|horny|kiss me|make love|sleep with me|strip|send (me )?(a )?(pic|pics|picture|pictures|photo)s? of (you|your)|hot girl|hot boy|bra|dick|pussy|cock|cum|blowjob|erotic|fetish|masturbat\w*)\b/;

/** Valence words for messages that match no specific intent ("my dog is sick" → sympathy). */
export const NEG_WORDS = W(`sad bad sick ill died dead death dying die lost lose losing failed fail failing failure broke broken hurt hurts pain painful cry crying cried terrible awful horrible worst worse hate hated angry upset
 tired exhausted lonely alone sorry problem problems trouble troubles difficult hard tough rough stress stressed stressful worried worry afraid scared fear accident hospital cancer fever headache cold flu cough injured injury
 fired unemployed divorce divorced breakup dumped cheated rejected ignored bullied fight fighting argued argument missing miss boring bored depressed depressing anxious nervous disappointed disappointing unfair ruined
 mess messed stuck poor expensive debt robbed stolen late missed forgot forgotten wrong mistake mistakes error errors nightmare disaster crisis struggling struggle suffering suffer crashed damaged leaking funeral grief`);
export const POS_WORDS = W(`happy good great awesome amazing wonderful excellent fantastic love loved lovely like liked enjoy enjoyed fun funny nice beautiful best better glad excited exciting proud passed pass won win winning
 success successful promoted promotion hired job birthday married engaged wedding baby born graduated graduation celebrate celebrating celebration party holiday vacation trip gift present surprise lucky blessed
 delicious tasty perfect brilliant cool sweet cute smart healthy recovered recovering improved improving finished completed achieved achievement award prize scholarship selected accepted topper champion friend friends peace relaxing relaxed`);

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
export const NUMWORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
